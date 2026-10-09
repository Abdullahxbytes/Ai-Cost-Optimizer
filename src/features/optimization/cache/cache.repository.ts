import { and, desc, eq, gt, lt, sql } from 'drizzle-orm';
import { db } from '../../../config/database';
import { auditLog } from '../../audit/audit.schema.db';
import { CACHE_SCHEMA_VERSION } from './cache.policy';
import { CacheDecision, isCurrentCacheEntry } from './cache.identity';
import { agentCachePolicies, responseCache } from './cache.schema.db';
import { semanticCache } from '../optimization.schema.db';

export type CacheScope = { orgId: string; agentId: string };
export type CacheEntry = typeof responseCache.$inferSelect;

function eligible(row: CacheEntry, decision: CacheDecision, kind: 'exact' | 'semantic'): boolean {
  return isCurrentCacheEntry(row, decision, kind);
}

export const cacheRepository = {
  async findExact(scope: CacheScope, decision: CacheDecision): Promise<CacheEntry | null> {
    if (decision.outcome === 'cache_bypassed') return null;
    const [row] = await db
      .select()
      .from(responseCache)
      .where(
        and(
          eq(responseCache.orgId, scope.orgId),
          eq(responseCache.agentId, scope.agentId),
          eq(responseCache.schemaVersion, CACHE_SCHEMA_VERSION),
          eq(responseCache.policyRevision, decision.policyRevision),
          eq(responseCache.exactKey, decision.exactKey),
          gt(responseCache.expiresAt, new Date())
        )
      )
      .orderBy(desc(responseCache.createdAt))
      .limit(1);
    return row && eligible(row, decision, 'exact') ? row : null;
  },

  async findSemantic(
    scope: CacheScope,
    decision: CacheDecision,
    embeddingModelVersion: string,
    embedding: number[]
  ) {
    if (
      decision.outcome !== 'semantic_cache_allowed' ||
      !decision.partitionKey ||
      embedding.length !== 768 ||
      embedding.some((value) => !Number.isFinite(value))
    )
      return null;
    const literal = `[${embedding.join(',')}]`;
    const distance = sql<number>`${responseCache.embedding} <=> ${literal}::vector`;
    const [row] = await db
      .select({ entry: responseCache, similarity: sql<number>`1 - (${distance})` })
      .from(responseCache)
      .where(
        and(
          eq(responseCache.orgId, scope.orgId),
          eq(responseCache.agentId, scope.agentId),
          eq(responseCache.schemaVersion, CACHE_SCHEMA_VERSION),
          eq(responseCache.policyRevision, decision.policyRevision),
          eq(responseCache.partitionKey, decision.partitionKey),
          eq(responseCache.embeddingModelVersion, embeddingModelVersion),
          gt(responseCache.expiresAt, new Date()),
          sql`${responseCache.embedding} is not null`
        )
      )
      .orderBy(distance)
      .limit(1);
    const similarity = Number(row?.similarity);
    return row &&
      Number.isFinite(similarity) &&
      similarity >= decision.similarityThreshold &&
      eligible(row.entry, decision, 'semantic')
      ? { entry: row.entry, similarity }
      : null;
  },

  async stillCurrent(scope: CacheScope, decision: CacheDecision): Promise<boolean> {
    if (decision.outcome === 'cache_bypassed') return false;
    const [row] = await db
      .select({ revision: agentCachePolicies.revision, policy: agentCachePolicies.policy })
      .from(agentCachePolicies)
      .where(
        and(
          eq(agentCachePolicies.orgId, scope.orgId),
          eq(agentCachePolicies.agentId, scope.agentId),
          eq(agentCachePolicies.revision, decision.policyRevision)
        )
      )
      .limit(1);
    return !!row;
  },

  async store(input: {
    scope: CacheScope;
    decision: CacheDecision;
    provider: string;
    model: string;
    response: unknown;
    embeddingModelVersion?: string;
    embedding?: number[];
  }): Promise<boolean> {
    const { scope, decision } = input;
    if (decision.outcome === 'cache_bypassed') return false;
    if (
      input.embedding &&
      (decision.outcome !== 'semantic_cache_allowed' ||
        input.embedding.length !== 768 ||
        input.embedding.some((value) => !Number.isFinite(value)) ||
        !input.embeddingModelVersion)
    )
      return false;
    return db.transaction(async (tx) => {
      // Row lock serializes policy replacement and an in-flight cache write.
      const [current] = await tx
        .select({ revision: agentCachePolicies.revision })
        .from(agentCachePolicies)
        .where(
          and(
            eq(agentCachePolicies.orgId, scope.orgId),
            eq(agentCachePolicies.agentId, scope.agentId),
            eq(agentCachePolicies.revision, decision.policyRevision)
          )
        )
        .for('share')
        .limit(1);
      if (!current) return false;
      const now = new Date();
      const expiresAt = new Date(now.getTime() + decision.ttlSeconds * 1000);
      await tx
        .insert(responseCache)
        .values({
          orgId: scope.orgId,
          agentId: scope.agentId,
          schemaVersion: CACHE_SCHEMA_VERSION,
          policyRevision: decision.policyRevision,
          exactKey: decision.exactKey,
          partitionKey: input.embedding ? decision.partitionKey : null,
          provider: input.provider,
          model: input.model,
          embeddingModelVersion: input.embedding ? input.embeddingModelVersion : null,
          embedding: input.embedding,
          response: input.response,
          createdAt: now,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: [responseCache.orgId, responseCache.agentId, responseCache.exactKey],
          set: {
            response: input.response,
            createdAt: now,
            expiresAt,
            policyRevision: decision.policyRevision,
            partitionKey: input.embedding ? decision.partitionKey : null,
            embeddingModelVersion: input.embedding ? input.embeddingModelVersion : null,
            embedding: input.embedding ?? null,
            provider: input.provider,
            model: input.model,
          },
        });
      return true;
    });
  },

  async purgeAgent(scope: CacheScope, actorUserId: string): Promise<number> {
    return db.transaction(async (tx) => {
      const rows = await tx
        .delete(responseCache)
        .where(and(eq(responseCache.orgId, scope.orgId), eq(responseCache.agentId, scope.agentId)))
        .returning({ id: responseCache.id });
      const legacy = await tx
        .delete(semanticCache)
        .where(and(eq(semanticCache.orgId, scope.orgId), eq(semanticCache.agentId, scope.agentId)))
        .returning({ id: semanticCache.id });
      await tx
        .insert(auditLog)
        .values({
          orgId: scope.orgId,
          actorUserId,
          eventType: 'response_cache_purged',
          targetType: 'agent',
          targetId: scope.agentId,
          metadata: {
            schemaVersion: CACHE_SCHEMA_VERSION,
            currentCount: rows.length,
            legacyCount: legacy.length,
          },
        });
      return rows.length + legacy.length;
    });
  },

  async deleteExpired(now = new Date()): Promise<number> {
    const rows = await db
      .delete(responseCache)
      .where(lt(responseCache.expiresAt, now))
      .returning({ id: responseCache.id });
    return rows.length;
  },
};

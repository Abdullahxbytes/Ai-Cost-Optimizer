import { and, asc, eq, gt, lt, sql } from 'drizzle-orm';
import { db } from '../../config/database';
import { optimizationRules, semanticCache } from './optimization.schema.db';

export type OptimizationSettings = {
  promptOptimizationEnabled: boolean;
  semanticCacheEnabled: boolean;
  cacheSimilarityThreshold: number;
  cacheTtlSeconds: number;
};

export type OptimizationSettingsUpdate = Partial<OptimizationSettings>;

export const DEFAULT_OPTIMIZATION_SETTINGS: OptimizationSettings = {
  promptOptimizationEnabled: false,
  semanticCacheEnabled: false,
  cacheSimilarityThreshold: 0.92,
  cacheTtlSeconds: 3600,
};

export type SemanticCacheMatch = {
  id: string;
  responseText: string;
  similarity: number;
};

export type SemanticCacheEntryInput = {
  orgId: string;
  agentId: string;
  embedding: number[];
  queryText: string;
  responseText: string;
  expiresAt: Date;
};

function vectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

export const optimizationRepository = {
  async getSettings(agentId: string): Promise<OptimizationSettings | null> {
    const [settings] = await db
      .select({
        promptOptimizationEnabled: optimizationRules.promptOptimizationEnabled,
        semanticCacheEnabled: optimizationRules.semanticCacheEnabled,
        cacheSimilarityThreshold: optimizationRules.cacheSimilarityThreshold,
        cacheTtlSeconds: optimizationRules.cacheTtlSeconds,
      })
      .from(optimizationRules)
      .where(eq(optimizationRules.agentId, agentId))
      .limit(1);

    if (!settings) return null;
    return {
      promptOptimizationEnabled: settings.promptOptimizationEnabled,
      semanticCacheEnabled: settings.semanticCacheEnabled,
      cacheSimilarityThreshold: Number(settings.cacheSimilarityThreshold),
      cacheTtlSeconds: settings.cacheTtlSeconds,
    };
  },

  async upsertSettings(
    orgId: string,
    agentId: string,
    update: OptimizationSettingsUpdate
  ): Promise<OptimizationSettings> {
    await db
      .insert(optimizationRules)
      .values({
        orgId,
        agentId,
        promptOptimizationEnabled:
          update.promptOptimizationEnabled ?? DEFAULT_OPTIMIZATION_SETTINGS.promptOptimizationEnabled,
        semanticCacheEnabled:
          update.semanticCacheEnabled ?? DEFAULT_OPTIMIZATION_SETTINGS.semanticCacheEnabled,
        cacheSimilarityThreshold: String(
          update.cacheSimilarityThreshold ?? DEFAULT_OPTIMIZATION_SETTINGS.cacheSimilarityThreshold
        ),
        cacheTtlSeconds: update.cacheTtlSeconds ?? DEFAULT_OPTIMIZATION_SETTINGS.cacheTtlSeconds,
      })
      .onConflictDoUpdate({
        target: optimizationRules.agentId,
        set: {
          ...(update.promptOptimizationEnabled !== undefined && {
            promptOptimizationEnabled: update.promptOptimizationEnabled,
          }),
          ...(update.semanticCacheEnabled !== undefined && {
            semanticCacheEnabled: update.semanticCacheEnabled,
          }),
          ...(update.cacheSimilarityThreshold !== undefined && {
            cacheSimilarityThreshold: String(update.cacheSimilarityThreshold),
          }),
          ...(update.cacheTtlSeconds !== undefined && { cacheTtlSeconds: update.cacheTtlSeconds }),
          updatedAt: new Date(),
        },
      });

    return (await this.getSettings(agentId)) ?? DEFAULT_OPTIMIZATION_SETTINGS;
  },

  async findClosestMatch(
    orgId: string,
    agentId: string,
    embedding: number[]
  ): Promise<SemanticCacheMatch | null> {
    const queryEmbedding = vectorLiteral(embedding);
    const [match] = await db
      .select({
        id: semanticCache.id,
        responseText: semanticCache.responseText,
        similarity: sql<number>`1 - (${semanticCache.embedding} <=> ${queryEmbedding}::vector)`,
      })
      .from(semanticCache)
      .where(
        and(
          eq(semanticCache.orgId, orgId),
          eq(semanticCache.agentId, agentId),
          gt(semanticCache.expiresAt, new Date())
        )
      )
      .orderBy(asc(sql`${semanticCache.embedding} <=> ${queryEmbedding}::vector`))
      .limit(1);

    return match ?? null;
  },

  async incrementHitCount(id: string): Promise<void> {
    await db
      .update(semanticCache)
      .set({ hitCount: sql`${semanticCache.hitCount} + 1`, updatedAt: new Date() })
      .where(eq(semanticCache.id, id));
  },

  async insertCacheEntry(input: SemanticCacheEntryInput): Promise<void> {
    await db.insert(semanticCache).values({
      orgId: input.orgId,
      agentId: input.agentId,
      embedding: input.embedding,
      queryText: input.queryText,
      responseText: input.responseText,
      hitCount: 0,
      expiresAt: input.expiresAt,
    });
  },

  async deleteExpiredEntries(now = new Date()): Promise<number> {
    const deleted = await db
      .delete(semanticCache)
      .where(lt(semanticCache.expiresAt, now))
      .returning({ id: semanticCache.id });
    return deleted.length;
  },
};

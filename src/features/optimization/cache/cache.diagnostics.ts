import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../../config/database';
import { cacheRequestDiagnostics } from './cache.schema.db';
import { CacheScope } from './cache.repository';

export type CacheDiagnostic = {
  scope: CacheScope;
  taskId: string | null;
  provider: string;
  model: string | null;
  outcome: 'bypass' | 'miss' | 'exact_hit' | 'semantic_hit' | 'provider_error';
  reason: string;
  lookupLatencyMs: number;
  embeddingLatencyMs?: number;
  embeddingInputTokens?: number;
  embeddingCostUsd?: string;
  embeddingCostStatus?: 'none' | 'unknown' | 'estimated' | 'exact';
};

export const cacheDiagnostics = {
  async record(input: CacheDiagnostic): Promise<void> {
    await db.insert(cacheRequestDiagnostics).values({
      orgId: input.scope.orgId,
      agentId: input.scope.agentId,
      taskId: input.taskId,
      provider: input.provider,
      model: input.model,
      outcome: input.outcome,
      reason: input.reason.slice(0, 128),
      lookupLatencyMs: Math.max(0, Math.round(input.lookupLatencyMs)),
      embeddingLatencyMs: input.embeddingLatencyMs,
      embeddingInputTokens: input.embeddingInputTokens,
      embeddingCostUsd: input.embeddingCostUsd,
      embeddingCostStatus: input.embeddingCostStatus ?? 'none',
    });
  },
  list(scope: CacheScope, limit = 50) {
    return db
      .select({
        createdAt: cacheRequestDiagnostics.createdAt,
        outcome: cacheRequestDiagnostics.outcome,
        reason: cacheRequestDiagnostics.reason,
        provider: cacheRequestDiagnostics.provider,
        model: cacheRequestDiagnostics.model,
        lookupLatencyMs: cacheRequestDiagnostics.lookupLatencyMs,
        embeddingLatencyMs: cacheRequestDiagnostics.embeddingLatencyMs,
        embeddingInputTokens: cacheRequestDiagnostics.embeddingInputTokens,
        embeddingCostUsd: cacheRequestDiagnostics.embeddingCostUsd,
        embeddingCostStatus: cacheRequestDiagnostics.embeddingCostStatus,
      })
      .from(cacheRequestDiagnostics)
      .where(
        and(
          eq(cacheRequestDiagnostics.orgId, scope.orgId),
          eq(cacheRequestDiagnostics.agentId, scope.agentId)
        )
      )
      .orderBy(desc(cacheRequestDiagnostics.createdAt))
      .limit(Math.min(100, Math.max(1, limit)));
  },
};

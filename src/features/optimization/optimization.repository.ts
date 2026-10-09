import { eq, lt } from 'drizzle-orm';
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

export const optimizationRepository = {
  async getCacheTransformationVersion(agentId: string): Promise<string> {
    const [row] = await db
      .select({ promptOptimizationEnabled: optimizationRules.promptOptimizationEnabled, updatedAt: optimizationRules.updatedAt })
      .from(optimizationRules)
      .where(eq(optimizationRules.agentId, agentId))
      .limit(1);
    return row ? `${row.promptOptimizationEnabled ? 'on' : 'off'}:${row.updatedAt.toISOString()}` : 'off:default';
  },
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

  async deleteExpiredEntries(now = new Date()): Promise<number> {
    const deleted = await db
      .delete(semanticCache)
      .where(lt(semanticCache.expiresAt, now))
      .returning({ id: semanticCache.id });
    return deleted.length;
  },
};

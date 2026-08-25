import { and, count, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '../../config/database';
import { agents, usageEvents } from '../../db/schema';

export type UsageEventInput = {
  orgId: string;
  agentId: string;
  taskId: string;
  provider: string;
  model: string;
  environment: 'dev' | 'staging' | 'prod';
  inputTokens: number;
  outputTokens: number;
  costUsd: string;
  latencyMs: number;
  isTest: boolean;
  status?: 'success' | 'error' | 'timeout';
  cacheHit?: boolean;
  originalTokenCount?: number;
  optimizedTokenCount?: number;
};

export type SavingsScope = 'org' | 'team' | 'agent';
export type DateRange = { from: Date; to: Date };
export type SavingsSummaryData = {
  totalCalls: number;
  totalCost: number;
  cacheHits: number;
  costSavedFromCache: number;
  totalTokensSaved: number;
  optimizationSavingsByModel: Array<{ provider: string; model: string; tokensSaved: number }>;
};

function scopeCondition(scope: SavingsScope, scopeId: string) {
  if (scope === 'org') return eq(usageEvents.orgId, scopeId);
  if (scope === 'agent') return eq(usageEvents.agentId, scopeId);
  return sql<boolean>`exists (select 1 from ${agents} where ${agents.id} = ${usageEvents.agentId} and ${agents.teamId} = ${scopeId})`;
}

export const proxyRepository = {
  async insertUsageEvent(input: UsageEventInput): Promise<void> {
    const [{ existingSteps }] = await db
      .select({ existingSteps: count() })
      .from(usageEvents)
      .where(eq(usageEvents.taskId, input.taskId));

    await db.insert(usageEvents).values({
      orgId: input.orgId,
      agentId: input.agentId,
      taskId: input.taskId,
      stepNumber: Number(existingSteps) + 1,
      provider: input.provider,
      model: input.model,
      callType: 'llm_call',
      environment: input.environment,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      costUsd: input.costUsd,
      latencyMs: input.latencyMs,
      status: input.status ?? 'success',
      isTest: input.isTest,
      cacheHit: input.cacheHit ?? false,
      originalTokenCount: input.originalTokenCount ?? input.inputTokens,
      optimizedTokenCount: input.optimizedTokenCount ?? input.inputTokens,
    });
  },

  async getSavingsSummary(
    scope: SavingsScope,
    scopeId: string,
    dateRange: DateRange
  ): Promise<SavingsSummaryData> {
    const conditions = and(
      scopeCondition(scope, scopeId),
      gte(usageEvents.createdAt, dateRange.from),
      lte(usageEvents.createdAt, dateRange.to)
    );
    const [totals] = await db
      .select({
        totalCalls: count(),
        totalCost: sql<string>`coalesce(sum(${usageEvents.costUsd}), 0)`,
        cacheHits: sql<number>`coalesce(sum(case when ${usageEvents.cacheHit} then 1 else 0 end), 0)`,
        totalTokensSaved: sql<number>`coalesce(sum(greatest(coalesce(${usageEvents.originalTokenCount}, 0) - coalesce(${usageEvents.optimizedTokenCount}, 0), 0)), 0)`,
      })
      .from(usageEvents)
      .where(conditions);

    const cacheCostByModel = await db
      .select({
        provider: usageEvents.provider,
        model: usageEvents.model,
        cacheHits: sql<number>`coalesce(sum(case when ${usageEvents.cacheHit} then 1 else 0 end), 0)`,
        averageNonCachedCost: sql<string>`coalesce(avg(case when not ${usageEvents.cacheHit} then ${usageEvents.costUsd} end), 0)`,
      })
      .from(usageEvents)
      .where(conditions)
      .groupBy(usageEvents.provider, usageEvents.model);

    const optimizationSavingsByModel = await db
      .select({
        provider: usageEvents.provider,
        model: usageEvents.model,
        tokensSaved: sql<number>`coalesce(sum(greatest(coalesce(${usageEvents.originalTokenCount}, 0) - coalesce(${usageEvents.optimizedTokenCount}, 0), 0)), 0)`,
      })
      .from(usageEvents)
      .where(conditions)
      .groupBy(usageEvents.provider, usageEvents.model);

    // Cache-hit events have no provider usage. Their avoided cost is therefore an estimate based
    // on the average non-cached cost for the same provider/model inside this selected scope/range.
    const costSavedFromCache = cacheCostByModel.reduce(
      (total, row) => total + Number(row.cacheHits) * Number(row.averageNonCachedCost),
      0
    );

    return {
      totalCalls: Number(totals?.totalCalls ?? 0),
      totalCost: Number(totals?.totalCost ?? 0),
      cacheHits: Number(totals?.cacheHits ?? 0),
      costSavedFromCache,
      totalTokensSaved: Number(totals?.totalTokensSaved ?? 0),
      optimizationSavingsByModel: optimizationSavingsByModel.map((row) => ({
        provider: row.provider,
        model: row.model,
        tokensSaved: Number(row.tokensSaved),
      })),
    };
  },
};

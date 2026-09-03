import { and, count, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '../../config/database';
import { agentTasks, agents, usageEvents } from '../../db/schema';

export type AnalyticsScope = 'org' | 'team' | 'agent';
export type AnalyticsRange = { from: Date; to: Date };
export type TimeBucket = 'daily' | 'weekly' | 'monthly';

function scopeCondition(scope: AnalyticsScope, scopeId: string) {
  if (scope === 'org') return eq(usageEvents.orgId, scopeId);
  if (scope === 'agent') return eq(usageEvents.agentId, scopeId);
  return sql<boolean>`exists (select 1 from ${agents} where ${agents.id} = ${usageEvents.agentId} and ${agents.teamId} = ${scopeId})`;
}
function conditions(scope: AnalyticsScope, scopeId: string, range: AnalyticsRange) {
  return and(scopeCondition(scope, scopeId), gte(usageEvents.createdAt, range.from), lte(usageEvents.createdAt, range.to));
}
function periodExpression(bucket: TimeBucket) {
  const unit = bucket === 'daily' ? 'day' : bucket === 'weekly' ? 'week' : 'month';
  const format = bucket === 'daily' ? 'YYYY-MM-DD' : bucket === 'weekly' ? 'IYYY-"W"IW' : 'YYYY-MM';
  return sql<string>`to_char(date_trunc(${sql.raw(`'${unit}'`)}, ${usageEvents.createdAt} at time zone 'UTC'), ${sql.raw(`'${format}'`)})`;
}

export const analyticsRepository = {
  // Rollup tables are not populated by any current job, so usage_events is the complete source of truth.
  async costsByTime(scope: AnalyticsScope, scopeId: string, range: AnalyticsRange, bucket: TimeBucket) {
    const period = periodExpression(bucket);
    return db.select({ period, totalCost: sql<string>`coalesce(sum(${usageEvents.costUsd}), 0)`, callCount: count() })
      .from(usageEvents).where(conditions(scope, scopeId, range)).groupBy(period).orderBy(period);
  },
  async costsByProvider(scope: AnalyticsScope, scopeId: string, range: AnalyticsRange) {
    return db.select({ provider: usageEvents.provider, totalCost: sql<string>`coalesce(sum(${usageEvents.costUsd}), 0)`, callCount: count() })
      .from(usageEvents).where(conditions(scope, scopeId, range)).groupBy(usageEvents.provider).orderBy(usageEvents.provider);
  },
  async costsByModel(scope: AnalyticsScope, scopeId: string, range: AnalyticsRange) {
    return db.select({ provider: usageEvents.provider, model: usageEvents.model, totalCost: sql<string>`coalesce(sum(${usageEvents.costUsd}), 0)`, callCount: count() })
      .from(usageEvents).where(conditions(scope, scopeId, range)).groupBy(usageEvents.provider, usageEvents.model).orderBy(usageEvents.provider, usageEvents.model);
  },
  async tokenSummary(scope: AnalyticsScope, scopeId: string, range: AnalyticsRange) {
    const [row] = await db.select({
      totalInputTokens: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)`,
      totalOutputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)`, callCount: count(),
    }).from(usageEvents).where(conditions(scope, scopeId, range));
    return row;
  },
  async tokensByAgent(scope: AnalyticsScope, scopeId: string, range: AnalyticsRange) {
    // usage_events.agent_id is ON DELETE CASCADE, so deleted agents have no surviving rows to display.
    return db.select({ agentId: agents.id, agentName: agents.name,
      inputTokens: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)`, callCount: count(),
    }).from(usageEvents).innerJoin(agents, eq(agents.id, usageEvents.agentId))
      .where(conditions(scope, scopeId, range)).groupBy(agents.id, agents.name).orderBy(agents.name);
  },
  async tokenSavings(scope: AnalyticsScope, scopeId: string, range: AnalyticsRange) {
    const where = conditions(scope, scopeId, range);
    const [optimization] = await db.select({
      tokens: sql<number>`coalesce(sum(greatest(coalesce(${usageEvents.originalTokenCount}, 0) - coalesce(${usageEvents.optimizedTokenCount}, 0), 0)), 0)`,
    }).from(usageEvents).where(where);
    const cacheGroups = await db.select({
      cacheHits: sql<number>`coalesce(sum(case when ${usageEvents.cacheHit} then 1 else 0 end), 0)`,
      averageInputTokens: sql<number>`coalesce(avg(case when not ${usageEvents.cacheHit} then ${usageEvents.inputTokens} end), 0)`,
      averageOutputTokens: sql<number>`coalesce(avg(case when not ${usageEvents.cacheHit} then ${usageEvents.outputTokens} end), 0)`,
    }).from(usageEvents).where(where).groupBy(usageEvents.provider, usageEvents.model);
    return {
      promptOptimizationTokensSaved: Number(optimization?.tokens ?? 0),
      // Same selected-scope/range, provider/model average-non-cached approach as the savings summary.
      cacheHitTokensSaved: cacheGroups.reduce((total, row) => total + Number(row.cacheHits) * (Number(row.averageInputTokens) + Number(row.averageOutputTokens)), 0),
    };
  },
  async cacheHitRate(scope: AnalyticsScope, scopeId: string, range: AnalyticsRange, bucket: TimeBucket) {
    const period = periodExpression(bucket);
    return db.select({ period, totalCalls: count(), cacheHits: sql<number>`coalesce(sum(case when ${usageEvents.cacheHit} then 1 else 0 end), 0)` })
      .from(usageEvents).where(conditions(scope, scopeId, range)).groupBy(period).orderBy(period);
  },
  async tokenReduction(scope: AnalyticsScope, scopeId: string, range: AnalyticsRange) {
    const where = and(conditions(scope, scopeId, range), sql`${usageEvents.originalTokenCount} > ${usageEvents.optimizedTokenCount}`);
    const [row] = await db.select({ totalCallsOptimized: count(), avgTokenReductionPercent: sql<number>`coalesce(avg((${usageEvents.originalTokenCount} - ${usageEvents.optimizedTokenCount})::numeric / ${usageEvents.originalTokenCount}) * 100, 0)` })
      .from(usageEvents).where(where);
    return row;
  },
  async costSavingsGroups(scope: AnalyticsScope, scopeId: string, range: AnalyticsRange) {
    const where = conditions(scope, scopeId, range);
    const cache = await db.select({
      cacheHits: sql<number>`coalesce(sum(case when ${usageEvents.cacheHit} then 1 else 0 end), 0)`,
      averageNonCachedCost: sql<string>`coalesce(avg(case when not ${usageEvents.cacheHit} then ${usageEvents.costUsd} end), 0)`,
    }).from(usageEvents).where(where).groupBy(usageEvents.provider, usageEvents.model);
    const optimization = await db.select({ provider: usageEvents.provider, model: usageEvents.model,
      tokensSaved: sql<number>`coalesce(sum(greatest(coalesce(${usageEvents.originalTokenCount}, 0) - coalesce(${usageEvents.optimizedTokenCount}, 0), 0)), 0)`,
    }).from(usageEvents).where(where).groupBy(usageEvents.provider, usageEvents.model);
    return { cacheSavingsUsd: cache.reduce((total, row) => total + Number(row.cacheHits) * Number(row.averageNonCachedCost), 0), optimization };
  },
  async comparisonUsage(scope: AnalyticsScope, scopeId: string, range: AnalyticsRange) {
    return db.select({ provider: usageEvents.provider, model: usageEvents.model,
      inputTokens: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)`, outputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)`, actualCost: sql<string>`coalesce(sum(${usageEvents.costUsd}), 0)`,
    }).from(usageEvents).where(conditions(scope, scopeId, range)).groupBy(usageEvents.provider, usageEvents.model);
  },
  async costPerTask(scope: AnalyticsScope, scopeId: string, range: AnalyticsRange) {
    return db.select({ taskId: agentTasks.taskId, agentId: agents.id, agentName: agents.name, outcome: agentTasks.outcome,
      totalCost: sql<string>`coalesce(sum(${usageEvents.costUsd}), 0)`, stepCount: count(),
    }).from(usageEvents).innerJoin(agentTasks, eq(agentTasks.taskId, usageEvents.taskId)).innerJoin(agents, eq(agents.id, usageEvents.agentId))
      .where(conditions(scope, scopeId, range)).groupBy(agentTasks.taskId, agents.id, agents.name, agentTasks.outcome).orderBy(agentTasks.taskId);
  },
};

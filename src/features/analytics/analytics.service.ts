import { AuthenticatedUser } from '../../middleware/auth';
import { canAccessAgent, canAccessTeam } from '../../middleware/rbac';
import { ForbiddenError, ValidationError } from '../../utils/errors';
import { agentsRepository } from '../agents/agents.repository';
import { teamsRepository } from '../teams/teams.repository';
import { pricingRepository } from '../pricing/pricing.repository';
import { AnalyticsRange, AnalyticsScope, TimeBucket, analyticsRepository } from './analytics.repository';

export type AnalyticsRequest = { scope: AnalyticsScope; scopeId?: string; range: AnalyticsRange; bucket?: TimeBucket };

async function resolveScope(user: AuthenticatedUser, request: AnalyticsRequest): Promise<{ scope: AnalyticsScope; scopeId: string }> {
  if (!user.orgId) throw new ForbiddenError('Organization access denied');
  const scopeId = request.scopeId ?? (request.scope === 'org' ? user.orgId : undefined);
  if (!scopeId) throw new ValidationError('scopeId is required for team and agent analytics');
  if (user.role === 'finance') {
    if (request.scope !== 'org' || scopeId !== user.orgId) throw new ForbiddenError('Finance can access organization analytics only');
    return { scope: 'org', scopeId };
  }
  if (user.role === 'developer') {
    if (request.scope !== 'agent' || !(await canAccessAgent(user, scopeId))) throw new ForbiddenError('Agent access denied');
    return { scope: 'agent', scopeId };
  }
  if (user.role === 'team_lead') {
    if (request.scope === 'team' && await canAccessTeam(user, scopeId)) return { scope: 'team', scopeId };
    if (request.scope === 'agent' && await canAccessAgent(user, scopeId)) return { scope: 'agent', scopeId };
    throw new ForbiddenError(request.scope === 'team' ? 'Team access denied' : 'Agent access denied');
  }
  if (user.role !== 'org_admin') throw new ForbiddenError('Insufficient permissions');
  if (request.scope === 'org') {
    if (scopeId !== user.orgId) throw new ForbiddenError('Organization access denied');
    return { scope: 'org', scopeId };
  }
  if (request.scope === 'team') {
    const team = await teamsRepository.findById(scopeId);
    if (!team || team.orgId !== user.orgId) throw new ForbiddenError('Team access denied');
    return { scope: 'team', scopeId };
  }
  const agent = await agentsRepository.findById(scopeId);
  if (!agent || agent.orgId !== user.orgId) throw new ForbiddenError('Agent access denied');
  return { scope: 'agent', scopeId };
}

function floor(date: Date, bucket: TimeBucket) {
  const value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  if (bucket === 'weekly') value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
  if (bucket === 'monthly') value.setUTCDate(1);
  return value;
}
function key(date: Date, bucket: TimeBucket) {
  if (bucket === 'daily') return date.toISOString().slice(0, 10);
  if (bucket === 'monthly') return date.toISOString().slice(0, 7);
  const weekYear = new Date(date); weekYear.setUTCDate(weekYear.getUTCDate() + 3);
  const firstThursday = new Date(Date.UTC(weekYear.getUTCFullYear(), 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() + 3 - ((firstThursday.getUTCDay() + 6) % 7));
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / 604800000);
  return `${weekYear.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
function advance(date: Date, bucket: TimeBucket) {
  const next = new Date(date);
  if (bucket === 'daily') next.setUTCDate(next.getUTCDate() + 1);
  else if (bucket === 'weekly') next.setUTCDate(next.getUTCDate() + 7);
  else next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}
function zeroFill<T extends object>(range: AnalyticsRange, bucket: TimeBucket, rows: Array<{ period: string } & T>, empty: T) {
  const values = new Map(rows.map((row) => [row.period, row])); const output: Array<{ period: string } & T> = [];
  for (let current = floor(range.from, bucket), last = floor(range.to, bucket); current <= last; current = advance(current, bucket)) {
    const period = key(current, bucket); output.push(values.get(period) ?? { period, ...empty });
  }
  return output;
}

export const analyticsService = {
  async byTime(user: AuthenticatedUser, request: AnalyticsRequest) {
    const bucket = request.bucket ?? 'daily'; const scope = await resolveScope(user, request);
    const rows = await analyticsRepository.costsByTime(scope.scope, scope.scopeId, request.range, bucket);
    return zeroFill(request.range, bucket, rows.map((row) => ({ period: row.period, totalCost: Number(row.totalCost), callCount: Number(row.callCount) })), { totalCost: 0, callCount: 0 });
  },
  async byProvider(user: AuthenticatedUser, request: AnalyticsRequest) {
    const scope = await resolveScope(user, request);
    return (await analyticsRepository.costsByProvider(scope.scope, scope.scopeId, request.range)).map((row) => ({ ...row, totalCost: Number(row.totalCost), callCount: Number(row.callCount) }));
  },
  async byModel(user: AuthenticatedUser, request: AnalyticsRequest) {
    const scope = await resolveScope(user, request);
    return (await analyticsRepository.costsByModel(scope.scope, scope.scopeId, request.range)).map((row) => ({ ...row, totalCost: Number(row.totalCost), callCount: Number(row.callCount) }));
  },
  async tokenSummary(user: AuthenticatedUser, request: AnalyticsRequest) {
    const scope = await resolveScope(user, request); const row = await analyticsRepository.tokenSummary(scope.scope, scope.scopeId, request.range);
    const totalInputTokens = Number(row?.totalInputTokens ?? 0); const totalOutputTokens = Number(row?.totalOutputTokens ?? 0);
    // Efficiency is output tokens per input token; zero input has no meaningful ratio.
    return { totalInputTokens, totalOutputTokens, efficiencyRatio: totalInputTokens ? totalOutputTokens / totalInputTokens : 0, totalCalls: Number(row?.callCount ?? 0) };
  },
  async tokensByAgent(user: AuthenticatedUser, request: AnalyticsRequest) {
    const scope = await resolveScope(user, request); const rows = await analyticsRepository.tokensByAgent(scope.scope, scope.scopeId, request.range);
    return rows.map((row) => {
      const inputTokens = Number(row.inputTokens); const outputTokens = Number(row.outputTokens);
      return { ...row, inputTokens, outputTokens, efficiencyRatio: inputTokens ? outputTokens / inputTokens : 0, callCount: Number(row.callCount) };
    });
  },
  async tokenSavings(user: AuthenticatedUser, request: AnalyticsRequest) {
    const scope = await resolveScope(user, request); const savings = await analyticsRepository.tokenSavings(scope.scope, scope.scopeId, request.range);
    return { ...savings, cacheHitTokensSaved_isEstimate: true };
  },
  async cacheHitRate(user: AuthenticatedUser, request: AnalyticsRequest) {
    const bucket = request.bucket ?? 'daily'; const scope = await resolveScope(user, request);
    const rows = await analyticsRepository.cacheHitRate(scope.scope, scope.scopeId, request.range, bucket);
    return zeroFill(request.range, bucket, rows.map((row) => {
      const totalCalls = Number(row.totalCalls); const cacheHits = Number(row.cacheHits);
      return { period: row.period, totalCalls, cacheHits, hitRate: totalCalls ? (cacheHits / totalCalls) * 100 : 0 };
    }), { totalCalls: 0, cacheHits: 0, hitRate: 0 });
  },
  async tokenReduction(user: AuthenticatedUser, request: AnalyticsRequest) {
    const scope = await resolveScope(user, request); const row = await analyticsRepository.tokenReduction(scope.scope, scope.scopeId, request.range);
    return { totalCallsOptimized: Number(row?.totalCallsOptimized ?? 0), avgTokenReductionPercent: Number(row?.avgTokenReductionPercent ?? 0) };
  },
  async optimizationCostSavings(user: AuthenticatedUser, request: AnalyticsRequest) {
    if (!user.orgId) throw new ForbiddenError('Organization access denied');
    const scope = await resolveScope(user, request); const groups = await analyticsRepository.costSavingsGroups(scope.scope, scope.scopeId, request.range);
    // Compression only affects prompt/input text, never provider output, so input pricing is used exclusively.
    const promptOptimizationSavingsUsd = (await Promise.all(groups.optimization.map(async (row) => {
      const rate = await pricingRepository.getRate(user.orgId!, row.provider, row.model);
      return rate ? (Number(row.tokensSaved) / 1000) * rate.inputPricePer1k : 0;
    }))).reduce((total, amount) => total + amount, 0);
    return { cacheSavingsUsd: groups.cacheSavingsUsd, promptOptimizationSavingsUsd, totalSavingsUsd: groups.cacheSavingsUsd + promptOptimizationSavingsUsd, isEstimate: true };
  },
  async providerCostComparison(user: AuthenticatedUser, request: AnalyticsRequest) {
    if (!user.orgId) throw new ForbiddenError('Organization access denied');
    const scope = await resolveScope(user, request); const usage = await analyticsRepository.comparisonUsage(scope.scope, scope.scopeId, request.range);
    const totalInputTokens = usage.reduce((total, row) => total + Number(row.inputTokens), 0);
    const totalOutputTokens = usage.reduce((total, row) => total + Number(row.outputTokens), 0);
    const actualByModel = new Map(usage.map((row) => [`${row.provider}\u0000${row.model}`, Number(row.actualCost)]));
    const comparisons = (await pricingRepository.listEffectiveRates(user.orgId)).map((rate) => ({
      provider: rate.provider, model: rate.model, actualCost: actualByModel.get(`${rate.provider}\u0000${rate.model}`) ?? 0,
      hypotheticalCost: (totalInputTokens / 1000) * rate.inputPricePer1k + (totalOutputTokens / 1000) * rate.outputPricePer1k,
    }));
    return { disclaimer: 'Price-only comparison using the selected range’s real token volume; it does not account for model quality, capability, latency, or suitability.', comparisons };
  },
  async simulateProviderSwitch(user: AuthenticatedUser, request: AnalyticsRequest, targetProvider: string, targetModel: string) {
    if (!user.orgId) throw new ForbiddenError('Organization access denied');
    const scope = await resolveScope(user, request);
    // Reuses the Day 7 comparison aggregation: no separate usage-total query is introduced.
    const usage = await analyticsRepository.comparisonUsage(scope.scope, scope.scopeId, request.range);
    const rate = await pricingRepository.getRate(user.orgId, targetProvider, targetModel);
    if (!rate) throw new ValidationError('No pricing configured for that provider/model');
    const totalInputTokens = usage.reduce((total, row) => total + Number(row.inputTokens), 0);
    const totalOutputTokens = usage.reduce((total, row) => total + Number(row.outputTokens), 0);
    const actualCost = usage.reduce((total, row) => total + Number(row.actualCost), 0);
    const providers = [...new Set(usage.map((row) => row.provider))];
    const simulatedCost = (totalInputTokens / 1000) * rate.inputPricePer1k + (totalOutputTokens / 1000) * rate.outputPricePer1k;
    const difference = simulatedCost - actualCost;
    return {
      actualCost,
      actualProvider: providers.length === 1 ? providers[0] : providers.length ? 'mixed' : null,
      simulatedCost,
      targetProvider,
      targetModel,
      difference,
      percentChange: actualCost ? (difference / actualCost) * 100 : 0,
      disclaimer: 'Price-only comparison using the selected range’s real token volume; it does not account for model quality, capability, latency, or suitability.',
    };
  },
  async agentsCostPerTask(user: AuthenticatedUser, request: AnalyticsRequest) {
    const scope = await resolveScope(user, request);
    return (await analyticsRepository.costPerTask(scope.scope, scope.scopeId, request.range)).map((row) => ({ ...row, totalCost: Number(row.totalCost), stepCount: Number(row.stepCount) }));
  },
};

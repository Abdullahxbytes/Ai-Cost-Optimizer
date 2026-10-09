import { eq } from 'drizzle-orm';
import { db } from '../../config/database';
import { agents } from '../../db/schema';
import { NotFoundError } from '../../utils/errors';
import { pricingRepository } from '../pricing/pricing.repository';
import { DateRange, proxyRepository, SavingsScope } from '../proxy/proxy.repository';
import {
  DEFAULT_OPTIMIZATION_SETTINGS,
  OptimizationSettings,
  OptimizationSettingsUpdate,
  optimizationRepository,
} from './optimization.repository';

export type SavingsSummary = {
  totalCalls: number;
  totalCost: number;
  cacheHits: number;
  cacheHitRate: number;
  costSavedFromCache: number;
  totalTokensSaved: number;
  estimatedCostSavedFromOptimization: number;
};

async function getAgent(agentId: string) {
  const [agent] = await db
    .select({ id: agents.id, orgId: agents.orgId })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  if (!agent) throw new NotFoundError('Agent not found');
  return agent;
}

export const optimizationService = {
  async getSettings(agentId: string): Promise<OptimizationSettings> {
    await getAgent(agentId);
    return (await optimizationRepository.getSettings(agentId)) ?? DEFAULT_OPTIMIZATION_SETTINGS;
  },

  async updateSettings(
    agentId: string,
    update: OptimizationSettingsUpdate
  ): Promise<OptimizationSettings> {
    const agent = await getAgent(agentId);
    return optimizationRepository.upsertSettings(agent.orgId, agent.id, update);
  },

  async getSavingsSummary(
    scope: SavingsScope,
    scopeId: string,
    orgId: string,
    dateRange: DateRange
  ): Promise<SavingsSummary> {
    const summary = await proxyRepository.getSavingsSummary(scope, scopeId, dateRange);
    const estimatedCostSavedFromOptimization = (
      await Promise.all(
        summary.optimizationSavingsByModel.map(async (row) => {
          const rate = await pricingRepository.getRate(orgId, row.provider, row.model);
          // Token savings are input prompt reductions; use the currently effective input rate as an estimate.
          return rate ? (row.tokensSaved / 1000) * rate.inputPricePer1k : 0;
        })
      )
    ).reduce((total, cost) => total + cost, 0);

    return {
      totalCalls: summary.totalCalls,
      totalCost: summary.totalCost,
      cacheHits: summary.cacheHits,
      cacheHitRate:
        summary.totalCalls === 0
          ? 0
          : Number(((summary.cacheHits / summary.totalCalls) * 100).toFixed(2)),
      costSavedFromCache: summary.costSavedFromCache,
      totalTokensSaved: summary.totalTokensSaved,
      estimatedCostSavedFromOptimization: Number(estimatedCostSavedFromOptimization.toFixed(8)),
    };
  },
};

import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { analyticsController } from './analytics.controller';
import { analyticsRateLimit } from '../../middleware/security';

export const analyticsRoutes: FastifyPluginAsync = async (app) => {
  const access = [
    authenticate,
    requireRole(['org_admin', 'finance', 'team_lead', 'developer']),
    analyticsRateLimit,
  ];
  app.get('/analytics/costs/by-time', { preHandler: access }, (request) => analyticsController.byTime(request));
  app.get('/analytics/costs/by-provider', { preHandler: access }, (request) => analyticsController.byProvider(request));
  app.get('/analytics/costs/by-model', { preHandler: access }, (request) => analyticsController.byModel(request));
  app.get('/analytics/tokens/summary', { preHandler: access }, (request) => analyticsController.tokenSummary(request));
  app.get('/analytics/tokens/by-agent', { preHandler: access }, (request) => analyticsController.tokensByAgent(request));
  app.get('/analytics/tokens/savings', { preHandler: access }, (request) => analyticsController.tokenSavings(request));
  app.get('/analytics/cache/hit-rate', { preHandler: access }, (request) => analyticsController.cacheHitRate(request));
  app.get('/analytics/optimization/token-reduction', { preHandler: access }, (request) => analyticsController.tokenReduction(request));
  app.get('/analytics/optimization/cost-savings', { preHandler: access }, (request) => analyticsController.optimizationCostSavings(request));
  app.get('/analytics/providers/cost-comparison', { preHandler: access }, (request) => analyticsController.providerCostComparison(request));
  app.get('/analytics/simulate/provider-switch', { preHandler: access }, (request) => analyticsController.simulateProviderSwitch(request));
  app.get('/analytics/agents/cost-per-task', { preHandler: access }, (request) => analyticsController.agentsCostPerTask(request));
};

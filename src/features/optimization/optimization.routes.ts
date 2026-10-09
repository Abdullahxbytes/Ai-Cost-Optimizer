import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../../middleware/auth';
import { requireOrgScope, requireRole } from '../../middleware/rbac';
import { optimizationController } from './optimization.controller';

export const optimizationRoutes: FastifyPluginAsync = async (app) => {
  const agentAccess = [
    authenticate,
    requireRole(['org_admin', 'team_lead', 'developer']),
    requireOrgScope(),
  ];
  app.get('/agents/:agentId/optimization-settings', { preHandler: agentAccess }, (request) =>
    optimizationController.getSettings(request as never)
  );
  app.get('/agents/:agentId/cache-policy', { preHandler: agentAccess }, (request) =>
    optimizationController.getCachePolicy(request as never)
  );
  app.put('/agents/:agentId/cache-policy', { preHandler: agentAccess }, (request) =>
    optimizationController.replaceCachePolicy(request as never)
  );
  app.delete('/agents/:agentId/cache', { preHandler: agentAccess }, (request) =>
    optimizationController.purgeCache(request as never)
  );
  app.post('/agents/:agentId/cache-context', { preHandler: agentAccess }, (request) =>
    optimizationController.issueCacheContext(request as never)
  );
  app.get('/agents/:agentId/cache-diagnostics', { preHandler: agentAccess }, (request) =>
    optimizationController.getCacheDiagnostics(request as never)
  );
  app.patch('/agents/:agentId/optimization-settings', { preHandler: agentAccess }, (request) =>
    optimizationController.patchSettings(request as never)
  );
  app.get('/agents/:agentId/savings-summary', { preHandler: agentAccess }, (request) =>
    optimizationController.getAgentSavings(request as never)
  );
  app.get(
    '/teams/:teamId/savings-summary',
    {
      preHandler: [
        authenticate,
        requireRole(['org_admin', 'team_lead']),
        requireOrgScope(),
      ],
    },
    (request) => optimizationController.getTeamSavings(request as never)
  );
  app.get(
    '/orgs/:orgId/savings-summary',
    { preHandler: [authenticate, requireRole(['org_admin', 'finance']), requireOrgScope()] },
    (request) => optimizationController.getOrgSavings(request as never)
  );
};

import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../../middleware/auth';
import { requireOrgScope, requireRole } from '../../middleware/rbac';
import { pricingController } from './pricing.controller';

export const pricingRoutes: FastifyPluginAsync = async (app) => {
  const guard = [authenticate, requireRole(['org_admin']), requireOrgScope()];
  app.get('/orgs/:orgId/pricing', { preHandler: guard }, pricingController.list);
  app.post('/orgs/:orgId/pricing', { preHandler: guard }, pricingController.create);
  app.patch(
    '/orgs/:orgId/pricing/:pricingId',
    { preHandler: guard },
    pricingController.update as never
  );
  app.delete(
    '/orgs/:orgId/pricing/:pricingId',
    { preHandler: guard },
    pricingController.remove as never
  );
};

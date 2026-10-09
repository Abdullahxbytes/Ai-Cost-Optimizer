import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { alertsController } from './alerts.controller';

export const alertsRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/alerts',
    { preHandler: [authenticate, requireRole(['org_admin', 'team_lead'])] },
    (request) => alertsController.create(request)
  );
  app.get(
    '/alerts',
    { preHandler: [authenticate, requireRole(['org_admin', 'team_lead', 'developer'])] },
    (request) => alertsController.list(request)
  );
  app.get(
    '/alert-history',
    { preHandler: [authenticate, requireRole(['org_admin', 'team_lead'])] },
    (request) => alertsController.listHistory(request)
  );
  app.patch(
    '/alerts/:alertId',
    { preHandler: [authenticate, requireRole(['org_admin', 'team_lead'])] },
    (request) => alertsController.update(request as never)
  );
  app.post(
    '/alert-history/:alertHistoryId/acknowledge',
    { preHandler: [authenticate, requireRole(['org_admin', 'team_lead', 'developer'])] },
    (request) => alertsController.acknowledge(request as never)
  );
};

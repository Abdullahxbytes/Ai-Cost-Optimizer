import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../../middleware/auth';
import { requireOrgScope, requireRole } from '../../middleware/rbac';
import { teamsController } from './teams.controller';

export const teamsRoutes: FastifyPluginAsync = async (app) => {
  app.post('/teams', { preHandler: [authenticate, requireRole(['org_admin', 'team_lead'])] }, (request) =>
    teamsController.create(request)
  );
  app.get('/teams', { preHandler: [authenticate, requireRole(['org_admin', 'team_lead', 'developer'])] }, (request) =>
    teamsController.list(request)
  );
  const scopedAccess = [authenticate, requireRole(['org_admin', 'team_lead']), requireOrgScope()];
  app.get('/teams/:teamId', { preHandler: scopedAccess }, (request) => teamsController.get(request as never));
  app.patch('/teams/:teamId', { preHandler: scopedAccess }, (request) => teamsController.update(request as never));
  app.post('/teams/:teamId/sub-teams', { preHandler: scopedAccess }, (request) =>
    teamsController.createSubTeam(request as never)
  );
};

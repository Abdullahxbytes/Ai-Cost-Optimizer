import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../../middleware/auth';
import { requireOrgScope, requireRole } from '../../middleware/rbac';
import { teamsController } from './teams.controller';
import { exportRateLimit } from '../../middleware/rateLimits';

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
  app.get('/teams/:teamId/members', { preHandler: scopedAccess }, (request) => teamsController.listMembers(request as never));
  app.get('/teams/:teamId/available-developers', { preHandler: scopedAccess }, (request) => teamsController.listAvailableDevelopers(request as never));
  app.post('/teams/:teamId/members', { preHandler: scopedAccess }, (request) => teamsController.addMember(request as never));
  app.delete('/teams/:teamId/members/:userId', { preHandler: scopedAccess }, (request) => teamsController.removeMember(request as never));
  app.post('/teams/:teamId/deletion', { preHandler: [authenticate, requireRole(['org_admin']), requireOrgScope()] }, (request) => teamsController.requestDeletion(request as never));
  app.get('/team-deletions', { preHandler: [authenticate, requireRole(['org_admin', 'finance', 'auditor'])] }, (request) => teamsController.listArchivedDeletions(request));
  app.get('/team-deletions/:deletionId/export', { preHandler: [authenticate, requireRole(['org_admin', 'finance', 'auditor']), exportRateLimit] }, (request, reply) => teamsController.exportArchivedDeletion(request as never, reply));
};

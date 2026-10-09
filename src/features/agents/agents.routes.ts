import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../../middleware/auth';
import { requireOrgScope, requireRole } from '../../middleware/rbac';
import { agentsController } from './agents.controller';

export const agentsRoutes: FastifyPluginAsync = async (app) => {
  app.post('/agents', { preHandler: [authenticate, requireRole(['developer'])] }, (request) =>
    agentsController.register(request)
  );
  app.get(
    '/agents',
    { preHandler: [authenticate, requireRole(['developer', 'team_lead', 'org_admin'])] },
    (request) => agentsController.list(request)
  );
  app.get('/agent-deletions', { preHandler: [authenticate] }, (request) =>
    agentsController.listMyPendingDeletions(request)
  );
  const scoped = [
    authenticate,
    requireRole(['developer', 'team_lead', 'org_admin']),
    requireOrgScope(),
  ];
  app.get('/agents/:agentId', { preHandler: scoped }, (request) =>
    agentsController.get(request as never)
  );
  const approver = [authenticate, requireRole(['team_lead', 'org_admin']), requireOrgScope()];
  app.post('/agents/:agentId/approve', { preHandler: approver }, (request) =>
    agentsController.approve(request as never)
  );
  app.post('/agents/:agentId/reject', { preHandler: approver }, (request) =>
    agentsController.reject(request as never)
  );
  app.post('/agents/:agentId/pause', { preHandler: scoped }, (request) =>
    agentsController.pause(request as never)
  );
  app.post('/agents/:agentId/resume', { preHandler: scoped }, (request) =>
    agentsController.resume(request as never)
  );
  app.post('/agents/:agentId/request-deletion', { preHandler: approver }, (request) =>
    agentsController.requestDeletion(request as never)
  );
  app.get(
    '/agent-deletions/:deletionId/download',
    { preHandler: [authenticate] },
    (request, reply) => agentsController.downloadDeletionExport(request as never, reply)
  );
  app.post('/agent-deletions/:deletionId/confirm', { preHandler: [authenticate] }, (request) =>
    agentsController.confirmDeletion(request as never)
  );
};

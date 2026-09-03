import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { superAdminsController } from './super-admins.controller';
import { superAdminsRepository } from './super-admins.repository';
import { orgsRepository } from '../orgs/orgs.repository';
import { NotFoundError } from '../../utils/errors';
import { adminHealthService } from './admin-health.service';

export const superAdminsRoutes: FastifyPluginAsync = async (app) => {
  const superAdminOnly = [authenticate, requireRole(['super_admin'])];
  app.post('/super-admins', { preHandler: superAdminOnly }, async (request, reply) =>
    reply.status(201).send(await superAdminsController.create(request.user, request.body))
  );
  app.delete('/super-admins/:id', { preHandler: superAdminOnly }, async (request) =>
    superAdminsController.remove((request.params as { id: string }).id)
  );
  app.get('/super-admins', { preHandler: superAdminOnly }, () => superAdminsRepository.list());
  app.get('/orgs', { preHandler: superAdminOnly }, () => orgsRepository.list());
  app.post('/orgs/:orgId/block', { preHandler: superAdminOnly }, async (request) => {
    const org = await orgsRepository.setStatus((request.params as { orgId: string }).orgId, 'blocked');
    if (!org) throw new NotFoundError('Organization not found');
    return org;
  });
  app.post('/orgs/:orgId/unblock', { preHandler: superAdminOnly }, async (request) => {
    const org = await orgsRepository.setStatus((request.params as { orgId: string }).orgId, 'active');
    if (!org) throw new NotFoundError('Organization not found');
    return org;
  });
  app.get('/admin/health', { preHandler: superAdminOnly }, () => adminHealthService.system());
  app.get('/admin/health/endpoints', { preHandler: superAdminOnly }, () => adminHealthService.endpoints());
};

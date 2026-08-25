import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../../middleware/auth';
import { requireOrgScope, requireRole } from '../../middleware/rbac';
import { orgsController } from './orgs.controller';

export const orgsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/orgs/:orgId',
    {
      preHandler: [
        authenticate,
        requireRole(['org_admin', 'super_admin']),
        async (request) => {
          if (request.user.role === 'org_admin') await requireOrgScope()(request);
        },
      ],
    },
    (request) => orgsController.get(request as never)
  );
  app.patch(
    '/orgs/:orgId',
    { preHandler: [authenticate, requireRole(['org_admin']), requireOrgScope()] },
    (request) => orgsController.update(request as never)
  );
};

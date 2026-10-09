import { FastifyPluginAsync } from 'fastify';
import { userController } from './user.controller';
import { authenticate } from '../../middleware/auth';
import { requireOrgScope, requireRole } from '../../middleware/rbac';
export const userRoutes: FastifyPluginAsync = async (app) => {
  app.post('/signup', async (req, reply) =>
    reply.status(201).send(await userController.signup(req.body))
  );
  app.post('/login', async (req) => userController.login(req.body, req.ip));
  app.post('/2fa/setup', async (req) => userController.setup(req.headers.authorization));
  app.post('/2fa/verify', async (req) =>
    userController.verify(req.headers.authorization, req.body, req.ip)
  );
  app.post('/change-password', { preHandler: [authenticate] }, async (req) =>
    userController.changePassword(req.user, req.body)
  );
  app.get('/me', { preHandler: [authenticate] }, async (req) => userController.me(req.user));
};

// Kept in this file with authentication routes, but registered without the /auth prefix.
export const userManagementRoutes: FastifyPluginAsync = async (app) => {
  const orgAdmin = [authenticate, requireRole(['org_admin']), requireOrgScope()];
  app.get('/orgs/:orgId/users', { preHandler: orgAdmin }, async (request) =>
    userController.listOrganizationUsers(request.user, (request.params as { orgId: string }).orgId)
  );
  app.post('/orgs/:orgId/users', { preHandler: orgAdmin }, async (request, reply) =>
    reply.status(201).send(
      await userController.createOrganizationUser(
        request.user,
        (request.params as { orgId: string }).orgId,
        request.body
      )
    )
  );
  app.patch('/orgs/:orgId/users/:userId', { preHandler: orgAdmin }, async (request) =>
    userController.updateOrganizationUserRole(
      request.user,
      (request.params as { orgId: string; userId: string }).orgId,
      (request.params as { userId: string }).userId,
      request.body
    )
  );
  app.delete('/orgs/:orgId/users/:userId', { preHandler: orgAdmin }, async (request) =>
    userController.removeOrganizationUser(
      request.user,
      (request.params as { orgId: string; userId: string }).orgId,
      (request.params as { userId: string }).userId
    )
  );
};

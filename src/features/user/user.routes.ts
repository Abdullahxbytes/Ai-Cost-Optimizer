import { FastifyPluginAsync } from 'fastify';
import { userController } from './user.controller';
export const userRoutes: FastifyPluginAsync = async (app) => {
  app.post('/signup', async (req, reply) =>
    reply.status(201).send(await userController.signup(req.body))
  );
  app.post('/login', async (req) => userController.login(req.body));
  app.post('/2fa/setup', async (req) => userController.setup(req.headers.authorization));
  app.post('/2fa/verify', async (req) =>
    userController.verify(req.headers.authorization, req.body)
  );
};

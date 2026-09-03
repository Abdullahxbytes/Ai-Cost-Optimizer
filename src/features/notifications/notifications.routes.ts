import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../../middleware/auth';
import { notificationsController } from './notifications.controller';

export const notificationsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/notifications', { preHandler: [authenticate] }, (request) => notificationsController.list(request));
  app.patch('/notifications/:notificationId', { preHandler: [authenticate] }, (request) =>
    notificationsController.markRead(request as never)
  );
};

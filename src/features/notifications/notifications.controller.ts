import { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ValidationError } from '../../utils/errors';
import { notificationsService } from './notifications.service';

const patchSchema = z.object({ read: z.literal(true) }).strict();
const querySchema = z.object({ unreadOnly: z.enum(['true', 'false']).optional() });

export const notificationsController = {
  list(request: FastifyRequest) {
    const query = querySchema.safeParse(request.query);
    if (!query.success) throw new ValidationError(query.error.issues[0]?.message ?? 'Invalid notification query');
    return notificationsService.list(request.user.id, query.data.unreadOnly === 'true');
  },
  markRead(request: FastifyRequest<{ Params: { notificationId: string } }>) {
    const body = patchSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.issues[0]?.message ?? 'Notifications can only be marked read');
    return notificationsService.markRead(request.params.notificationId, request.user.id);
  },
};

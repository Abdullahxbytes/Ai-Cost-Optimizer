import { NotFoundError } from '../../utils/errors';
import { notificationsRepository } from './notifications.repository';

export const notificationsService = {
  list: (userId: string, unreadOnly: boolean) =>
    notificationsRepository.listForUser(userId, unreadOnly),
  async markRead(notificationId: string, userId: string) {
    const notification = await notificationsRepository.markRead(notificationId, userId);
    if (!notification) throw new NotFoundError('Notification not found');
    return notification;
  },
};

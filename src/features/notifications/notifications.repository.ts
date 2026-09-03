import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../../config/database';
import { users } from '../user/user.schema.db';
import { notifications } from './notifications.schema.db';

const notificationFields = {
  id: notifications.id, userId: notifications.userId, orgId: notifications.orgId,
  eventType: notifications.eventType, channel: notifications.channel, message: notifications.message,
  severity: notifications.severity, priority: notifications.priority, read: notifications.read,
  createdAt: notifications.createdAt,
};

export const notificationsRepository = {
  async createInAppNotifications(input: {
    orgId: string; userIds: string[]; eventType: string; message: string;
    severity?: string; priority?: string;
  }) {
    if (!input.userIds.length) return [];
    return db.insert(notifications).values(input.userIds.map((userId) => ({
      userId, orgId: input.orgId, channel: 'in_app' as const, eventType: input.eventType,
      severity: input.severity ?? 'P3', priority: input.priority ?? 'info', message: input.message, read: false,
    }))).returning(notificationFields);
  },
  async findBudgetAlertRecipientIds(orgId: string): Promise<string[]> {
    const recipients = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.orgId, orgId), eq(users.active, true), inArray(users.role, ['finance', 'org_admin'])));
    return recipients.map((recipient) => recipient.id);
  },
  async createBudgetAlertNotifications(input: { orgId: string; userIds: string[]; message: string }) {
    if (!input.userIds.length) return [];
    return db.insert(notifications).values(input.userIds.map((userId) => ({
      userId, orgId: input.orgId, channel: 'in_app' as const, eventType: 'budget_alert_triggered',
      severity: 'P3', priority: 'info', message: input.message, read: false,
    }))).returning(notificationFields);
  },
  async listForUser(userId: string, unreadOnly: boolean) {
    return db.select(notificationFields).from(notifications)
      .where(unreadOnly ? and(eq(notifications.userId, userId), eq(notifications.read, false)) : eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt));
  },
  async markRead(notificationId: string, userId: string) {
    const [notification] = await db.update(notifications)
      .set({ read: true, updatedAt: new Date() })
      .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)))
      .returning(notificationFields);
    return notification ?? null;
  },
};

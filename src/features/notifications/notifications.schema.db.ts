import { boolean, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
export const notificationChannelEnum = pgEnum('notification_channel', [
  'in_app',
  'webhook',
  'email',
]);
export const notifications = pgTable('notifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull(),
  orgId: uuid('org_id').notNull(),
  eventType: text('event_type').notNull(),
  channel: notificationChannelEnum('channel').notNull(),
  message: text('message').notNull(),
  read: boolean('read').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

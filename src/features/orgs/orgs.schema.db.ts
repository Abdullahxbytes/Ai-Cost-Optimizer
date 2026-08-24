import { pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
export const orgStatusEnum = pgEnum('org_status', ['active', 'blocked']);
export const orgs = pgTable('orgs', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull(),
  currency: text('currency').default('USD').notNull(),
  status: orgStatusEnum('status').default('active').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

import { boolean, index, numeric, pgEnum, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
const ts = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
export const alertTypeEnum = pgEnum('alert_type', ['budget', 'spike', 'runaway']);
export const alertHistoryStatusEnum = pgEnum('alert_history_status', [
  'triggered',
  'acknowledged',
  'resolved',
]);
export const alerts = pgTable('alerts', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull(),
  teamId: uuid('team_id'),
  agentId: uuid('agent_id'),
  type: alertTypeEnum('type').notNull(),
  thresholdPercent: numeric('threshold_percent', { precision: 5, scale: 2 }).notNull(),
  active: boolean('active').default(true).notNull(),
  ...ts(),
});
export const alertHistory = pgTable(
  'alert_history',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id').notNull(),
    alertId: uuid('alert_id').notNull(),
    triggeredAt: timestamp('triggered_at', { withTimezone: true }).defaultNow().notNull(),
    acknowledgedBy: uuid('acknowledged_by'),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    status: alertHistoryStatusEnum('status').default('triggered').notNull(),
    ...ts(),
  },
  (t) => ({
    idxAlertHistoryAlertTriggeredAt: index('idx_alert_history_alert_id_triggered_at').on(
      t.alertId,
      t.triggeredAt
    ),
  })
);

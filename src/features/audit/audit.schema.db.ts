import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id').notNull(),
    actorUserId: uuid('actor_user_id'),
    eventType: text('event_type').notNull(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id'),
    metadata: jsonb('metadata').default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idxAuditLogOrgCreatedAt: index('idx_audit_log_org_id_created_at').on(t.orgId, t.createdAt),
    idxAuditLogActorUserId: index('idx_audit_log_actor_user_id').on(t.actorUserId),
  })
);

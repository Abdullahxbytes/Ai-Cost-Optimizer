import {
  boolean,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
export const agentStatusEnum = pgEnum('agent_status', [
  'pending_approval',
  'active',
  'paused',
  'pending_deletion',
]);
export const requestStatusEnum = pgEnum('request_status', ['pending', 'approved', 'rejected']);
export const taskStatusEnum = pgEnum('task_status', ['pending', 'running', 'completed', 'failed']);
export const outcomeEnum = pgEnum('outcome', ['success', 'fail', 'pending']);
const ts = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
export const agents = pgTable(
  'agents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id').notNull(),
    teamId: uuid('team_id'),
    ownerUserId: uuid('owner_user_id').notNull(),
    name: text('name').notNull(),
    apiKey: text('api_key').notNull(),
    status: agentStatusEnum('status').default('pending_approval').notNull(),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedBy: uuid('approved_by'),
    ...ts(),
  },
  (t) => ({
    idxAgentsOrgId: index('idx_agents_org_id').on(t.orgId),
    idxAgentsTeamId: index('idx_agents_team_id').on(t.teamId),
    uqAgentsApiKey: uniqueIndex('idx_agents_api_key_unique').on(t.apiKey),
  })
);
export const agentApprovals = pgTable('agent_approvals', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull(),
  agentId: uuid('agent_id').notNull(),
  requestedBy: uuid('requested_by').notNull(),
  approvedBy: uuid('approved_by'),
  status: requestStatusEnum('status').default('pending').notNull(),
  requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true })
    .default(sql`now() + interval '14 days'`)
    .notNull(),
  ...ts(),
});
export const agentDeletions = pgTable('agent_deletions', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull(),
  agentId: uuid('agent_id').notNull(),
  csvExportUrl: text('csv_export_url'),
  recipientUserId: uuid('recipient_user_id').notNull(),
  confirmed: boolean('confirmed').default(false).notNull(),
  requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  ...ts(),
});
export const agentTasks = pgTable('agent_tasks', {
  taskId: uuid('task_id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull(),
  agentId: uuid('agent_id').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  status: taskStatusEnum('status').default('pending').notNull(),
  outcome: outcomeEnum('outcome').default('pending').notNull(),
  totalCost: numeric('total_cost', { precision: 12, scale: 4 }).notNull(),
  totalCalls: integer('total_calls').default(0).notNull(),
  ...ts(),
});

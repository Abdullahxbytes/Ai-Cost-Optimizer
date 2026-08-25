import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { agents } from '../agents/agents.schema.db';
const ts = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
const money = (n: string) => numeric(n, { precision: 12, scale: 4 }).notNull();
export const callTypeEnum = pgEnum('call_type', ['llm_call', 'embedding']);
export const environmentEnum = pgEnum('environment', ['dev', 'staging', 'prod']);
export const usageStatusEnum = pgEnum('usage_status', ['success', 'error', 'timeout']);
export const usageEvents = pgTable(
  'usage_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id').notNull(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id'),
    stepNumber: integer('step_number'),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    callType: callTypeEnum('call_type').notNull(),
    environment: environmentEnum('environment').notNull(),
    inputTokens: integer('input_tokens').default(0).notNull(),
    outputTokens: integer('output_tokens').default(0).notNull(),
    costUsd: money('cost_usd'),
    latencyMs: integer('latency_ms'),
    status: usageStatusEnum('status').notNull(),
    isTest: boolean('is_test').default(false).notNull(),
    cacheHit: boolean('cache_hit').default(false).notNull(),
    originalTokenCount: integer('original_token_count'),
    optimizedTokenCount: integer('optimized_token_count'),
    ...ts(),
  },
  (t) => ({
    idxUsageEventsOrgAgentCreatedAt: index('idx_usage_events_org_id_agent_id_created_at').on(
      t.orgId,
      t.agentId,
      t.createdAt
    ),
    idxUsageEventsTaskId: index('idx_usage_events_task_id').on(t.taskId),
    idxUsageEventsOrgEnvironment: index('idx_usage_events_org_id_environment').on(
      t.orgId,
      t.environment
    ),
    chkUsageEventsCostUsdNonnegative: check(
      'chk_usage_events_cost_usd_nonnegative',
      sql`${t.costUsd} >= 0`
    ),
  })
);
const rollup = (name: string, orgIndex: string, agentIndex: string) =>
  pgTable(
    name,
    {
      id: uuid('id').defaultRandom().primaryKey(),
      orgId: uuid('org_id').notNull(),
      teamId: uuid('team_id'),
      agentId: uuid('agent_id'),
      periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
      totalCost: money('total_cost'),
      totalCalls: integer('total_calls').default(0).notNull(),
      totalTokens: integer('total_tokens').default(0).notNull(),
      ...ts(),
    },
    (t) => ({
      [orgIndex]: index(orgIndex).on(t.orgId, t.periodStart),
      [agentIndex]: index(agentIndex).on(t.agentId, t.periodStart),
    })
  );
export const usageRollupHourly = rollup(
  'usage_rollup_hourly',
  'idx_usage_rollup_hourly_org_id_period_start',
  'idx_usage_rollup_hourly_agent_id_period_start'
);
export const usageRollupDaily = rollup(
  'usage_rollup_daily',
  'idx_usage_rollup_daily_org_id_period_start',
  'idx_usage_rollup_daily_agent_id_period_start'
);

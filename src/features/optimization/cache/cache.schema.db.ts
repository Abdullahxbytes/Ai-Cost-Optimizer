import { sql } from 'drizzle-orm';
import {
  check,
  index,
  uniqueIndex,
  integer,
  numeric,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';
import { agents } from '../../agents/agents.schema.db';
import { orgs } from '../../orgs/orgs.schema.db';

export const agentCachePolicies = pgTable(
  'agent_cache_policies',
  {
    agentId: uuid('agent_id')
      .primaryKey()
      .references(() => agents.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    schemaVersion: integer('schema_version').notNull().default(2),
    revision: integer('revision').notNull().default(1),
    // Parsed again on read: JSONB is not a substitute for runtime validation.
    policy: jsonb('policy').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    revisionCheck: check('cache_policy_revision_positive', sql`${t.revision} > 0`),
    versionCheck: check('cache_policy_schema_v2', sql`${t.schemaVersion} = 2`),
  })
);

// Separate, empty namespace. Never migrate legacy semantic_cache rows here:
// their full request identity and authorization context cannot be recovered.
export const responseCache = pgTable(
  'response_cache_v2',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    schemaVersion: integer('schema_version').notNull().default(2),
    policyRevision: integer('policy_revision').notNull(),
    exactKey: text('exact_key').notNull(),
    partitionKey: text('partition_key'),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    embeddingModelVersion: text('embedding_model_version'),
    embedding: vector('embedding', { dimensions: 768 }),
    response: jsonb('response').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => ({
    exactIndex: uniqueIndex('response_cache_v2_unique_exact').on(t.orgId, t.agentId, t.exactKey),
    partitionIndex: index('response_cache_v2_partition').on(
      t.orgId,
      t.agentId,
      t.partitionKey,
      t.embeddingModelVersion
    ),
    expiryIndex: index('response_cache_v2_expiry').on(t.expiresAt),
    versionCheck: check('response_cache_schema_v2', sql`${t.schemaVersion} = 2`),
    revisionCheck: check('response_cache_revision_positive', sql`${t.policyRevision} > 0`),
    expiryCheck: check(
      'response_cache_expiry_after_creation',
      sql`${t.expiresAt} > ${t.createdAt}`
    ),
    embeddingCheck: check(
      'response_cache_embedding_scope',
      sql`${t.embedding} is null or (${t.partitionKey} is not null and ${t.embeddingModelVersion} is not null)`
    ),
  })
);

export const cacheRequestDiagnostics = pgTable(
  'cache_request_diagnostics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id'),
    provider: text('provider').notNull(),
    model: text('model'),
    outcome: text('outcome').notNull(),
    reason: text('reason').notNull(),
    lookupLatencyMs: integer('lookup_latency_ms').notNull(),
    embeddingLatencyMs: integer('embedding_latency_ms'),
    embeddingInputTokens: integer('embedding_input_tokens'),
    embeddingCostUsd: numeric('embedding_cost_usd', { precision: 12, scale: 6 }),
    embeddingCostStatus: text('embedding_cost_status').notNull().default('none'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    scopeIndex: index('cache_request_diagnostics_scope').on(t.orgId, t.agentId, t.createdAt),
    latencyCheck: check('cache_diagnostics_latency_nonnegative', sql`${t.lookupLatencyMs} >= 0`),
  })
);

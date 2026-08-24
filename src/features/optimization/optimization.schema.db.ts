import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
const ts = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
export const routingRules = pgTable('routing_rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull(),
  teamId: uuid('team_id'),
  agentId: uuid('agent_id'),
  taskType: text('task_type').notNull(),
  targetModel: text('target_model').notNull(),
  targetProvider: text('target_provider').notNull(),
  active: boolean('active').default(true).notNull(),
  ...ts(),
});
export const optimizationRules = pgTable(
  'optimization_rules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id').notNull(),
    agentId: uuid('agent_id').notNull(),
    promptOptimizationEnabled: boolean('prompt_optimization_enabled').default(false).notNull(),
    semanticCacheEnabled: boolean('semantic_cache_enabled').default(false).notNull(),
    cacheSimilarityThreshold: numeric('cache_similarity_threshold', { precision: 4, scale: 2 })
      .default('0.92')
      .notNull(),
    cacheTtlSeconds: integer('cache_ttl_seconds').notNull(),
    ...ts(),
  },
  (t) => ({
    chkOptimizationRulesSimilarityThreshold: check(
      'chk_optimization_rules_similarity_threshold',
      sql`${t.cacheSimilarityThreshold} between 0 and 1`
    ),
  })
);
export const semanticCache = pgTable(
  'semantic_cache',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id').notNull(),
    agentId: uuid('agent_id').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }).notNull(),
    queryText: text('query_text').notNull(),
    responseText: text('response_text').notNull(),
    hitCount: integer('hit_count').default(0).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...ts(),
  },
  (t) => ({
    idxSemanticCacheOrgAgent: index('idx_semantic_cache_org_id_agent_id').on(t.orgId, t.agentId),
    idxSemanticCacheExpiresAt: index('idx_semantic_cache_expires_at').on(t.expiresAt),
  })
);

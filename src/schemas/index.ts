import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  vector,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { check, index, uniqueIndex } from 'drizzle-orm/pg-core'

const timestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

const money = (name: string) => numeric(name, { precision: 12, scale: 4 }).notNull()

export const roleEnum = pgEnum('role', ['super_admin', 'org_admin', 'team_lead', 'developer', 'finance', 'auditor'])
export const agentStatusEnum = pgEnum('agent_status', ['pending_approval', 'active', 'paused', 'pending_deletion'])
export const callTypeEnum = pgEnum('call_type', ['llm_call', 'embedding'])
export const environmentEnum = pgEnum('environment', ['dev', 'staging', 'prod'])
export const outcomeEnum = pgEnum('outcome', ['success', 'fail', 'pending'])
export const budgetScopeEnum = pgEnum('budget_scope', ['org', 'team', 'agent'])
export const notificationChannelEnum = pgEnum('notification_channel', ['in_app', 'webhook', 'email'])
export const orgStatusEnum = pgEnum('org_status', ['active', 'blocked'])
export const budgetPeriodEnum = pgEnum('budget_period', ['daily', 'monthly'])
export const requestStatusEnum = pgEnum('request_status', ['pending', 'approved', 'rejected'])
export const usageStatusEnum = pgEnum('usage_status', ['success', 'error', 'timeout'])
export const alertTypeEnum = pgEnum('alert_type', ['budget', 'spike', 'runaway'])
export const alertHistoryStatusEnum = pgEnum('alert_history_status', ['triggered', 'acknowledged', 'resolved'])
export const taskStatusEnum = pgEnum('task_status', ['pending', 'running', 'completed', 'failed'])

/** Tenant organizations and platform-level account settings. */
export const orgs = pgTable('orgs', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(), timezone: text('timezone').notNull(),
  currency: text('currency').default('USD').notNull(), status: orgStatusEnum('status').default('active').notNull(),
  ...timestamps(),
})

/** Users belonging to an organization. Unique email-per-org is added with indexes in Module 2. */
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(), orgId: uuid('org_id').notNull(), email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(), role: roleEnum('role').notNull(), twoFactorSecret: text('two_factor_secret'),
  ...timestamps(),
}, (table) => ({
  uqUsersOrgEmail: uniqueIndex('idx_users_org_id_email_unique').on(table.orgId, table.email),
}))

/** Teams, with hierarchy depth enforced by application logic. */
export const teams = pgTable('teams', {
  id: uuid('id').defaultRandom().primaryKey(), orgId: uuid('org_id').notNull(), name: text('name').notNull(),
  parentTeamId: uuid('parent_team_id'), teamLeadId: uuid('team_lead_id'), ...timestamps(),
}, (table) => ({
  chkTeamsNoSelfParent: check('chk_teams_no_self_parent', sql`${table.parentTeamId} is null or ${table.parentTeamId} <> ${table.id}`),
}))

/** Registered LLM-consuming agents. API-key uniqueness is added in Module 2. */
export const agents = pgTable('agents', {
  id: uuid('id').defaultRandom().primaryKey(), orgId: uuid('org_id').notNull(), teamId: uuid('team_id'), ownerUserId: uuid('owner_user_id').notNull(),
  name: text('name').notNull(), apiKey: text('api_key').notNull(), status: agentStatusEnum('status').default('pending_approval').notNull(),
  approvedAt: timestamp('approved_at', { withTimezone: true }), approvedBy: uuid('approved_by'), ...timestamps(),
}, (table) => ({
  idxAgentsOrgId: index('idx_agents_org_id').on(table.orgId),
  idxAgentsTeamId: index('idx_agents_team_id').on(table.teamId),
  uqAgentsApiKey: uniqueIndex('idx_agents_api_key_unique').on(table.apiKey),
}))

/** Approval workflow for agent activation. */
export const agentApprovals = pgTable('agent_approvals', {
  id: uuid('id').defaultRandom().primaryKey(), orgId: uuid('org_id').notNull(), agentId: uuid('agent_id').notNull(),
  requestedBy: uuid('requested_by').notNull(), approvedBy: uuid('approved_by'), status: requestStatusEnum('status').default('pending').notNull(),
  requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(), decidedAt: timestamp('decided_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).default(sql`now() + interval '14 days'`).notNull(), ...timestamps(),
})

/** Pending agent deletion confirmations and exported-data delivery details. */
export const agentDeletions = pgTable('agent_deletions', {
  id: uuid('id').defaultRandom().primaryKey(), orgId: uuid('org_id').notNull(), agentId: uuid('agent_id').notNull(), csvExportUrl: text('csv_export_url'),
  recipientUserId: uuid('recipient_user_id').notNull(), confirmed: boolean('confirmed').default(false).notNull(),
  requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(), confirmedAt: timestamp('confirmed_at', { withTimezone: true }), ...timestamps(),
})

/** Cost limits assigned at organization, team, or agent scope. */
export const budgets = pgTable('budgets', {
  id: uuid('id').defaultRandom().primaryKey(), orgId: uuid('org_id').notNull(), scope: budgetScopeEnum('scope').notNull(), scopeId: uuid('scope_id').notNull(),
  limitAmount: money('limit_amount'), currency: text('currency').default('USD').notNull(), period: budgetPeriodEnum('period').notNull(), resetTimezone: text('reset_timezone').notNull(), ...timestamps(),
}, (table) => ({
  idxBudgetsScopeScopeId: index('idx_budgets_scope_scope_id').on(table.scope, table.scopeId),
  chkBudgetsLimitAmountPositive: check('chk_budgets_limit_amount_positive', sql`${table.limitAmount} > 0`),
}))

/** Requested budget changes awaiting approval. */
export const budgetRequests = pgTable('budget_requests', {
  id: uuid('id').defaultRandom().primaryKey(), orgId: uuid('org_id').notNull(), budgetId: uuid('budget_id').notNull(), requestedBy: uuid('requested_by').notNull(),
  requestedAmount: money('requested_amount'), status: requestStatusEnum('status').default('pending').notNull(), approvedBy: uuid('approved_by'), ...timestamps(),
})

/** Global and per-tenant LLM pricing records. */
export const pricingTable = pgTable('pricing_table', {
  id: uuid('id').defaultRandom().primaryKey(), orgId: uuid('org_id'), provider: text('provider').notNull(), model: text('model').notNull(),
  inputPricePer1k: money('input_price_per_1k'), outputPricePer1k: money('output_price_per_1k'), currency: text('currency').default('USD').notNull(),
  effectiveDate: timestamp('effective_date', { withTimezone: true }).notNull(), ...timestamps(),
}, (table) => ({
  idxPricingTableOrgProviderModelEffectiveDate: index('idx_pricing_table_org_id_provider_model_effective_date').on(table.orgId, table.provider, table.model, table.effectiveDate),
}))

/** Audit history for pricing changes. */
export const pricingChangelog = pgTable('pricing_changelog', {
  id: uuid('id').defaultRandom().primaryKey(), orgId: uuid('org_id').notNull(), pricingTableId: uuid('pricing_table_id').notNull(), changedBy: uuid('changed_by').notNull(),
  oldValue: jsonb('old_value').notNull(), newValue: jsonb('new_value').notNull(), changedAt: timestamp('changed_at', { withTimezone: true }).defaultNow().notNull(), ...timestamps(),
})

/** Atomic provider usage records used for cost and performance analytics. */
export const usageEvents = pgTable('usage_events', {
  id: uuid('id').defaultRandom().primaryKey(), orgId: uuid('org_id').notNull(), agentId: uuid('agent_id').notNull(), taskId: uuid('task_id'), stepNumber: integer('step_number'),
  provider: text('provider').notNull(), model: text('model').notNull(), callType: callTypeEnum('call_type').notNull(), environment: environmentEnum('environment').notNull(),
  inputTokens: integer('input_tokens').default(0).notNull(), outputTokens: integer('output_tokens').default(0).notNull(), costUsd: money('cost_usd'), latencyMs: integer('latency_ms'),
  status: usageStatusEnum('status').notNull(), isTest: boolean('is_test').default(false).notNull(), cacheHit: boolean('cache_hit').default(false).notNull(),
  originalTokenCount: integer('original_token_count'), optimizedTokenCount: integer('optimized_token_count'), ...timestamps(),
}, (table) => ({
  idxUsageEventsOrgAgentCreatedAt: index('idx_usage_events_org_id_agent_id_created_at').on(table.orgId, table.agentId, table.createdAt),
  idxUsageEventsTaskId: index('idx_usage_events_task_id').on(table.taskId),
  idxUsageEventsOrgEnvironment: index('idx_usage_events_org_id_environment').on(table.orgId, table.environment),
  chkUsageEventsCostUsdNonnegative: check('chk_usage_events_cost_usd_nonnegative', sql`${table.costUsd} >= 0`),
}))

/** Hourly organization/team/agent usage aggregates. */
export const usageRollupHourly = pgTable('usage_rollup_hourly', {
  id: uuid('id').defaultRandom().primaryKey(), orgId: uuid('org_id').notNull(), teamId: uuid('team_id'), agentId: uuid('agent_id'), periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  totalCost: money('total_cost'), totalCalls: integer('total_calls').default(0).notNull(), totalTokens: integer('total_tokens').default(0).notNull(), ...timestamps(),
}, (table) => ({
  idxUsageRollupHourlyOrgPeriodStart: index('idx_usage_rollup_hourly_org_id_period_start').on(table.orgId, table.periodStart),
  idxUsageRollupHourlyAgentPeriodStart: index('idx_usage_rollup_hourly_agent_id_period_start').on(table.agentId, table.periodStart),
}))

/** Daily organization/team/agent usage aggregates. */
export const usageRollupDaily = pgTable('usage_rollup_daily', {
  id: uuid('id').defaultRandom().primaryKey(), orgId: uuid('org_id').notNull(), teamId: uuid('team_id'), agentId: uuid('agent_id'), periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  totalCost: money('total_cost'), totalCalls: integer('total_calls').default(0).notNull(), totalTokens: integer('total_tokens').default(0).notNull(), ...timestamps(),
}, (table) => ({
  idxUsageRollupDailyOrgPeriodStart: index('idx_usage_rollup_daily_org_id_period_start').on(table.orgId, table.periodStart),
  idxUsageRollupDailyAgentPeriodStart: index('idx_usage_rollup_daily_agent_id_period_start').on(table.agentId, table.periodStart),
}))

/** Multi-step work performed by an agent. */
export const agentTasks = pgTable('agent_tasks', {
  taskId: uuid('task_id').defaultRandom().primaryKey(), orgId: uuid('org_id').notNull(), agentId: uuid('agent_id').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(), endedAt: timestamp('ended_at', { withTimezone: true }), status: taskStatusEnum('status').default('pending').notNull(),
  outcome: outcomeEnum('outcome').default('pending').notNull(), totalCost: money('total_cost'), totalCalls: integer('total_calls').default(0).notNull(), ...timestamps(),
})

/** Deferred model-routing configuration. */
export const routingRules = pgTable('routing_rules', {
  id: uuid('id').defaultRandom().primaryKey(), orgId: uuid('org_id').notNull(), teamId: uuid('team_id'), agentId: uuid('agent_id'), taskType: text('task_type').notNull(),
  targetModel: text('target_model').notNull(), targetProvider: text('target_provider').notNull(), active: boolean('active').default(true).notNull(), ...timestamps(),
})

/** Agent prompt optimization and semantic-cache settings. */
export const optimizationRules = pgTable('optimization_rules', {
  id: uuid('id').defaultRandom().primaryKey(), orgId: uuid('org_id').notNull(), agentId: uuid('agent_id').notNull(),
  promptOptimizationEnabled: boolean('prompt_optimization_enabled').default(false).notNull(), semanticCacheEnabled: boolean('semantic_cache_enabled').default(false).notNull(),
  cacheSimilarityThreshold: numeric('cache_similarity_threshold', { precision: 4, scale: 2 }).default('0.92').notNull(), cacheTtlSeconds: integer('cache_ttl_seconds').notNull(), ...timestamps(),
}, (table) => ({
  chkOptimizationRulesSimilarityThreshold: check('chk_optimization_rules_similarity_threshold', sql`${table.cacheSimilarityThreshold} between 0 and 1`),
}))

/** pgvector-backed cached LLM responses. */
export const semanticCache = pgTable('semantic_cache', {
  id: uuid('id').defaultRandom().primaryKey(), orgId: uuid('org_id').notNull(), agentId: uuid('agent_id').notNull(), embedding: vector('embedding', { dimensions: 1536 }).notNull(),
  queryText: text('query_text').notNull(), responseText: text('response_text').notNull(), hitCount: integer('hit_count').default(0).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), ...timestamps(),
}, (table) => ({
  idxSemanticCacheOrgAgent: index('idx_semantic_cache_org_id_agent_id').on(table.orgId, table.agentId),
  idxSemanticCacheExpiresAt: index('idx_semantic_cache_expires_at').on(table.expiresAt),
}))

/** Budget, spike, and runaway-spend alert configurations. */
export const alerts = pgTable('alerts', {
  id: uuid('id').defaultRandom().primaryKey(), orgId: uuid('org_id').notNull(), teamId: uuid('team_id'), agentId: uuid('agent_id'),
  type: alertTypeEnum('type').notNull(), thresholdPercent: numeric('threshold_percent', { precision: 5, scale: 2 }).notNull(), active: boolean('active').default(true).notNull(), ...timestamps(),
})

/** Trigger and acknowledgement history for alerts. */
export const alertHistory = pgTable('alert_history', {
  id: uuid('id').defaultRandom().primaryKey(), orgId: uuid('org_id').notNull(), alertId: uuid('alert_id').notNull(), triggeredAt: timestamp('triggered_at', { withTimezone: true }).defaultNow().notNull(),
  acknowledgedBy: uuid('acknowledged_by'), acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }), status: alertHistoryStatusEnum('status').default('triggered').notNull(), ...timestamps(),
}, (table) => ({
  idxAlertHistoryAlertTriggeredAt: index('idx_alert_history_alert_id_triggered_at').on(table.alertId, table.triggeredAt),
}))

/** Extensible audit trail for tenant activity. */
export const auditLog = pgTable('audit_log', {
  id: uuid('id').defaultRandom().primaryKey(), orgId: uuid('org_id').notNull(), actorUserId: uuid('actor_user_id'), eventType: text('event_type').notNull(),
  targetType: text('target_type').notNull(), targetId: uuid('target_id'), metadata: jsonb('metadata').default({}).notNull(), ...timestamps(),
}, (table) => ({
  idxAuditLogOrgCreatedAt: index('idx_audit_log_org_id_created_at').on(table.orgId, table.createdAt),
  idxAuditLogActorUserId: index('idx_audit_log_actor_user_id').on(table.actorUserId),
}))

/** In-app, webhook, and email notifications. */
export const notifications = pgTable('notifications', {
  id: uuid('id').defaultRandom().primaryKey(), userId: uuid('user_id').notNull(), orgId: uuid('org_id').notNull(), eventType: text('event_type').notNull(),
  channel: notificationChannelEnum('channel').notNull(), message: text('message').notNull(), read: boolean('read').default(false).notNull(), ...timestamps(),
})

/** Organization-approved access grants for Super Admin support. */
export const accessGrants = pgTable('access_grants', {
  id: uuid('id').defaultRandom().primaryKey(), orgId: uuid('org_id').notNull(), grantedTo: uuid('granted_to').notNull(), grantedBy: uuid('granted_by').notNull(),
  reason: text('reason').notNull(), active: boolean('active').default(true).notNull(), revokedAt: timestamp('revoked_at', { withTimezone: true }), ...timestamps(),
})

export const orgsRelations = relations(orgs, ({ many }) => ({
  users: many(users),
  teams: many(teams),
  agents: many(agents),
  budgets: many(budgets),
  pricingRecords: many(pricingTable),
  alerts: many(alerts),
  auditEntries: many(auditLog),
  notifications: many(notifications),
  accessGrants: many(accessGrants),
}))

export const usersRelations = relations(users, ({ one, many }) => ({
  organization: one(orgs, { fields: [users.orgId], references: [orgs.id] }),
  ownedAgents: many(agents),
  ledTeams: many(teams, { relationName: 'teamLead' }),
}))

export const teamsRelations = relations(teams, ({ one, many }) => ({
  organization: one(orgs, { fields: [teams.orgId], references: [orgs.id] }),
  parentTeam: one(teams, { fields: [teams.parentTeamId], references: [teams.id], relationName: 'teamHierarchy' }),
  subTeams: many(teams, { relationName: 'teamHierarchy' }),
  teamLead: one(users, { fields: [teams.teamLeadId], references: [users.id], relationName: 'teamLead' }),
  agents: many(agents),
}))

export const agentsRelations = relations(agents, ({ one, many }) => ({
  organization: one(orgs, { fields: [agents.orgId], references: [orgs.id] }),
  team: one(teams, { fields: [agents.teamId], references: [teams.id] }),
  owner: one(users, { fields: [agents.ownerUserId], references: [users.id] }),
  usageEvents: many(usageEvents),
  tasks: many(agentTasks),
  approvals: many(agentApprovals),
  deletions: many(agentDeletions),
  optimizationRules: many(optimizationRules),
  semanticCacheEntries: many(semanticCache),
}))

export const usageEventsRelations = relations(usageEvents, ({ one }) => ({
  agent: one(agents, { fields: [usageEvents.agentId], references: [agents.id] }),
  task: one(agentTasks, { fields: [usageEvents.taskId], references: [agentTasks.taskId] }),
}))

export const agentTasksRelations = relations(agentTasks, ({ one, many }) => ({
  agent: one(agents, { fields: [agentTasks.agentId], references: [agents.id] }),
  usageEvents: many(usageEvents),
}))

export const agentApprovalsRelations = relations(agentApprovals, ({ one }) => ({
  agent: one(agents, { fields: [agentApprovals.agentId], references: [agents.id] }),
}))

export const agentDeletionsRelations = relations(agentDeletions, ({ one }) => ({
  agent: one(agents, { fields: [agentDeletions.agentId], references: [agents.id] }),
}))

export const budgetsRelations = relations(budgets, ({ one, many }) => ({
  organization: one(orgs, { fields: [budgets.orgId], references: [orgs.id] }),
  requests: many(budgetRequests),
}))

export const budgetRequestsRelations = relations(budgetRequests, ({ one }) => ({
  budget: one(budgets, { fields: [budgetRequests.budgetId], references: [budgets.id] }),
}))

export const pricingTableRelations = relations(pricingTable, ({ one, many }) => ({
  organization: one(orgs, { fields: [pricingTable.orgId], references: [orgs.id] }),
  changelogEntries: many(pricingChangelog),
}))

export const pricingChangelogRelations = relations(pricingChangelog, ({ one }) => ({
  pricingRecord: one(pricingTable, { fields: [pricingChangelog.pricingTableId], references: [pricingTable.id] }),
}))

export const optimizationRulesRelations = relations(optimizationRules, ({ one }) => ({
  agent: one(agents, { fields: [optimizationRules.agentId], references: [agents.id] }),
}))

export const semanticCacheRelations = relations(semanticCache, ({ one }) => ({
  agent: one(agents, { fields: [semanticCache.agentId], references: [agents.id] }),
}))

export const alertsRelations = relations(alerts, ({ one, many }) => ({
  organization: one(orgs, { fields: [alerts.orgId], references: [orgs.id] }),
  history: many(alertHistory),
}))

export const alertHistoryRelations = relations(alertHistory, ({ one }) => ({
  alert: one(alerts, { fields: [alertHistory.alertId], references: [alerts.id] }),
}))

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  organization: one(orgs, { fields: [auditLog.orgId], references: [orgs.id] }),
}))

export const notificationsRelations = relations(notifications, ({ one }) => ({
  organization: one(orgs, { fields: [notifications.orgId], references: [orgs.id] }),
}))

export const accessGrantsRelations = relations(accessGrants, ({ one }) => ({
  organization: one(orgs, { fields: [accessGrants.orgId], references: [orgs.id] }),
}))

import { relations } from 'drizzle-orm';
import { orgs } from '../features/orgs/orgs.schema.db';
import { accessGrants, users } from '../features/user/user.schema.db';
import { teams } from '../features/teams/teams.schema.db';
import {
  agents,
  agentApprovals,
  agentDeletions,
  agentTasks,
} from '../features/agents/agents.schema.db';
import { budgets, budgetRequests } from '../features/budgets/budgets.schema.db';
import { pricingTable, pricingChangelog } from '../features/pricing/pricing.schema.db';
import { usageEvents } from '../features/proxy/proxy.schema.db';
import { optimizationRules, semanticCache } from '../features/optimization/optimization.schema.db';
import { alerts, alertHistory } from '../features/alerts/alerts.schema.db';
import { auditLog } from '../features/audit/audit.schema.db';
import { notifications } from '../features/notifications/notifications.schema.db';
import { orgProviderKeys } from '../features/provider-keys/provider-keys.schema.db';
export * from '../features/user/user.schema.db';
export * from '../features/orgs/orgs.schema.db';
export * from '../features/teams/teams.schema.db';
export * from '../features/agents/agents.schema.db';
export * from '../features/budgets/budgets.schema.db';
export * from '../features/pricing/pricing.schema.db';
export * from '../features/proxy/proxy.schema.db';
export * from '../features/optimization/optimization.schema.db';
export * from '../features/optimization/cache/cache.schema.db';
export * from '../features/alerts/alerts.schema.db';
export * from '../features/audit/audit.schema.db';
export * from '../features/notifications/notifications.schema.db';
export * from '../features/provider-keys/provider-keys.schema.db';
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
  providerKeys: many(orgProviderKeys),
}));
export const usersRelations = relations(users, ({ one, many }) => ({
  organization: one(orgs, { fields: [users.orgId], references: [orgs.id] }),
  ownedAgents: many(agents),
  ledTeams: many(teams, { relationName: 'teamLead' }),
}));
export const teamsRelations = relations(teams, ({ one, many }) => ({
  organization: one(orgs, { fields: [teams.orgId], references: [orgs.id] }),
  parentTeam: one(teams, {
    fields: [teams.parentTeamId],
    references: [teams.id],
    relationName: 'teamHierarchy',
  }),
  subTeams: many(teams, { relationName: 'teamHierarchy' }),
  teamLead: one(users, {
    fields: [teams.teamLeadId],
    references: [users.id],
    relationName: 'teamLead',
  }),
  agents: many(agents),
}));
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
}));
export const usageEventsRelations = relations(usageEvents, ({ one }) => ({
  agent: one(agents, { fields: [usageEvents.agentId], references: [agents.id] }),
  task: one(agentTasks, { fields: [usageEvents.taskId], references: [agentTasks.taskId] }),
}));
export const agentTasksRelations = relations(agentTasks, ({ one, many }) => ({
  agent: one(agents, { fields: [agentTasks.agentId], references: [agents.id] }),
  usageEvents: many(usageEvents),
}));
export const agentApprovalsRelations = relations(agentApprovals, ({ one }) => ({
  agent: one(agents, { fields: [agentApprovals.agentId], references: [agents.id] }),
}));
export const agentDeletionsRelations = relations(agentDeletions, ({ one }) => ({
  agent: one(agents, { fields: [agentDeletions.agentId], references: [agents.id] }),
}));
export const budgetsRelations = relations(budgets, ({ one, many }) => ({
  organization: one(orgs, { fields: [budgets.orgId], references: [orgs.id] }),
  requests: many(budgetRequests),
}));
export const budgetRequestsRelations = relations(budgetRequests, ({ one }) => ({
  budget: one(budgets, { fields: [budgetRequests.budgetId], references: [budgets.id] }),
}));
export const pricingTableRelations = relations(pricingTable, ({ one, many }) => ({
  organization: one(orgs, { fields: [pricingTable.orgId], references: [orgs.id] }),
  changelogEntries: many(pricingChangelog),
}));
export const pricingChangelogRelations = relations(pricingChangelog, ({ one }) => ({
  pricingRecord: one(pricingTable, {
    fields: [pricingChangelog.pricingTableId],
    references: [pricingTable.id],
  }),
}));
export const optimizationRulesRelations = relations(optimizationRules, ({ one }) => ({
  agent: one(agents, { fields: [optimizationRules.agentId], references: [agents.id] }),
}));
export const semanticCacheRelations = relations(semanticCache, ({ one }) => ({
  agent: one(agents, { fields: [semanticCache.agentId], references: [agents.id] }),
}));
export const alertsRelations = relations(alerts, ({ one, many }) => ({
  organization: one(orgs, { fields: [alerts.orgId], references: [orgs.id] }),
  history: many(alertHistory),
}));
export const alertHistoryRelations = relations(alertHistory, ({ one }) => ({
  alert: one(alerts, { fields: [alertHistory.alertId], references: [alerts.id] }),
}));
export const auditLogRelations = relations(auditLog, ({ one }) => ({
  organization: one(orgs, { fields: [auditLog.orgId], references: [orgs.id] }),
}));
export const notificationsRelations = relations(notifications, ({ one }) => ({
  organization: one(orgs, { fields: [notifications.orgId], references: [orgs.id] }),
}));
export const accessGrantsRelations = relations(accessGrants, ({ one }) => ({
  organization: one(orgs, { fields: [accessGrants.orgId], references: [orgs.id] }),
}));

import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { db } from '../../config/database';
import { auditLog } from '../audit/audit.schema.db';
import { budgetRequests, budgets } from '../budgets/budgets.schema.db';
import { usageEvents } from '../proxy/proxy.schema.db';
import { teams } from '../teams/teams.schema.db';
import { agentApprovals, agentDeletions, agents } from './agents.schema.db';

export type AgentStatus = 'pending_approval' | 'active' | 'paused' | 'pending_deletion';
const agentFields = {
  id: agents.id, orgId: agents.orgId, teamId: agents.teamId, ownerUserId: agents.ownerUserId,
  name: agents.name, apiKey: agents.apiKey, status: agents.status, approvedAt: agents.approvedAt, approvedBy: agents.approvedBy,
};

export const agentsRepository = {
  async create(input: { orgId: string; teamId: string; ownerUserId: string; name: string; apiKey: string }) {
    const [agent] = await db.insert(agents).values({ ...input, status: 'pending_approval' }).returning(agentFields);
    const [approval] = await db.insert(agentApprovals).values({ orgId: input.orgId, agentId: agent.id, requestedBy: input.ownerUserId, status: 'pending' }).returning();
    return { agent, approval };
  },

  async findById(agentId: string) {
    const [agent] = await db.select(agentFields).from(agents).where(eq(agents.id, agentId)).limit(1);
    return agent ?? null;
  },

  async findTeam(teamId: string) {
    const [team] = await db.select({ id: teams.id, orgId: teams.orgId, teamLeadId: teams.teamLeadId }).from(teams).where(eq(teams.id, teamId)).limit(1);
    return team ?? null;
  },

  async listByOwner(ownerUserId: string) { return db.select(agentFields).from(agents).where(eq(agents.ownerUserId, ownerUserId)); },
  async listByOrganization(orgId: string) { return db.select(agentFields).from(agents).where(eq(agents.orgId, orgId)); },
  async listByTeams(teamIds: string[]) {
    return teamIds.length ? db.select(agentFields).from(agents).where(inArray(agents.teamId, teamIds)) : [];
  },
  async listTeamIdsLedBy(userId: string) {
    const rows = await db.select({ id: teams.id }).from(teams).where(eq(teams.teamLeadId, userId));
    return rows.map((team) => team.id);
  },

  async latestApproval(agentId: string) {
    const [approval] = await db.select().from(agentApprovals).where(eq(agentApprovals.agentId, agentId)).orderBy(desc(agentApprovals.requestedAt)).limit(1);
    return approval ?? null;
  },
  async decideApproval(approvalId: string, status: 'approved' | 'rejected', actorUserId: string) {
    await db.update(agentApprovals).set({ status, approvedBy: actorUserId, decidedAt: new Date(), updatedAt: new Date() }).where(eq(agentApprovals.id, approvalId));
  },
  async updateStatus(agentId: string, status: AgentStatus, actorUserId?: string) {
    const [agent] = await db.update(agents).set({ status, ...(status === 'active' && { approvedAt: new Date(), approvedBy: actorUserId }), updatedAt: new Date() }).where(eq(agents.id, agentId)).returning(agentFields);
    return agent ?? null;
  },
  async recordRejection(orgId: string, agentId: string, actorUserId: string, reason?: string) {
    await db.insert(auditLog).values({ orgId, actorUserId, eventType: 'agent_rejected', targetType: 'agent', targetId: agentId, metadata: { ...(reason && { reason }) } });
  },
  async usageHistoryForExport(agentId: string) {
    return db.select({
      createdAt: usageEvents.createdAt, provider: usageEvents.provider, model: usageEvents.model,
      inputTokens: usageEvents.inputTokens, outputTokens: usageEvents.outputTokens,
      costUsd: usageEvents.costUsd, status: usageEvents.status,
    }).from(usageEvents).where(eq(usageEvents.agentId, agentId)).orderBy(usageEvents.createdAt);
  },
  async createDeletion(input: { id: string; orgId: string; agentId: string; csvExportUrl: string; recipientUserId: string }) {
    const [deletion] = await db.insert(agentDeletions).values({ ...input, confirmed: false }).returning();
    return deletion;
  },
  async findDeletion(deletionId: string) {
    const [deletion] = await db.select().from(agentDeletions).where(eq(agentDeletions.id, deletionId)).limit(1);
    return deletion ?? null;
  },
  async findOpenDeletionForAgent(agentId: string) {
    const [deletion] = await db.select().from(agentDeletions).where(and(eq(agentDeletions.agentId, agentId), eq(agentDeletions.confirmed, false))).limit(1);
    return deletion ?? null;
  },
  async findUnconfirmedDeletionReminders(olderThan: Date) {
    return db.select().from(agentDeletions).where(and(eq(agentDeletions.confirmed, false), lt(agentDeletions.requestedAt, olderThan)));
  },
  async approvalFacts(agentId: string) {
    return db.select({ approvedBy: agentApprovals.approvedBy, decidedAt: agentApprovals.decidedAt })
      .from(agentApprovals)
      .where(and(eq(agentApprovals.agentId, agentId), eq(agentApprovals.status, 'approved')));
  },
  async confirmAndDelete(input: { deletionId: string; agent: { id: string; orgId: string; teamId: string | null; name: string }; deletedBy: string; approvalFacts: Array<{ approvedBy: string | null; decidedAt: Date | null }> }) {
    await db.transaction(async (tx) => {
      await tx.update(agentDeletions).set({ confirmed: true, confirmedAt: new Date(), updatedAt: new Date() }).where(eq(agentDeletions.id, input.deletionId));
      await tx.insert(auditLog).values({
        orgId: input.agent.orgId,
        actorUserId: input.deletedBy,
        eventType: 'agent_deleted',
        targetType: 'agent',
        targetId: input.agent.id,
        metadata: {
          agentName: input.agent.name,
          teamId: input.agent.teamId,
          deletedAt: new Date().toISOString(),
          deletedBy: input.deletedBy,
          approvalHistory: input.approvalFacts,
        },
      });
      // scope_id is polymorphic, so agent-scoped budgets cannot use a database FK cascade.
      const agentBudgetIds = await tx
        .select({ id: budgets.id })
        .from(budgets)
        .where(and(eq(budgets.scope, 'agent'), eq(budgets.scopeId, input.agent.id)));
      if (agentBudgetIds.length) {
        await tx.delete(budgetRequests).where(inArray(budgetRequests.budgetId, agentBudgetIds.map((budget) => budget.id)));
        await tx.delete(budgets).where(inArray(budgets.id, agentBudgetIds.map((budget) => budget.id)));
      }
      await tx.delete(agentDeletions).where(eq(agentDeletions.id, input.deletionId));
      await tx.delete(agents).where(eq(agents.id, input.agent.id));
    });
  },
};

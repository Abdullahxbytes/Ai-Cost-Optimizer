import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../../config/database';
import { AuthenticatedUser } from '../../middleware/auth';
import { NotFoundError, ValidationError } from '../../utils/errors';
import { ForbiddenError } from '../../utils/errors';
import { agents, agentDeletions } from '../agents/agents.schema.db';
import { alertHistory, alerts } from '../alerts/alerts.schema.db';
import { auditLog } from '../audit/audit.schema.db';
import { budgetRequests, budgets } from '../budgets/budgets.schema.db';
import { notificationsRepository } from '../notifications/notifications.repository';
import { usageEvents } from '../proxy/proxy.schema.db';
import { users } from '../user/user.schema.db';
import { teamDeletions, teamMembers, teams } from './teams.schema.db';
import { teamsRepository } from './teams.repository';

async function assertOrganizationMember(userId: string, orgId: string) {
  if (!(await teamsRepository.isOrganizationMember(userId, orgId))) {
    throw new ValidationError('teamLeadId must belong to this organization');
  }
}

export const teamsService = {
  async createTopLevel(orgId: string, creatorId: string, name: string, teamLeadId?: string) {
    const leadId = teamLeadId ?? creatorId;
    await assertOrganizationMember(leadId, orgId);
    return teamsRepository.create({ orgId, name, teamLeadId: leadId });
  },

  async get(teamId: string) {
    const team = await teamsRepository.findById(teamId);
    if (!team) throw new NotFoundError('Team not found');
    return team;
  },

  async list(user: AuthenticatedUser) {
    if (!user.orgId) return [];
    if (user.role === 'org_admin') return teamsRepository.listForOrganization(user.orgId);
    if (user.role === 'team_lead') return teamsRepository.listLedBy(user.id);
    if (user.role === 'developer') return teamsRepository.listForDeveloper(user.id, user.orgId);
    return [];
  },

  async update(teamId: string, update: { name?: string; teamLeadId?: string }) {
    const current = await this.get(teamId);
    if (update.teamLeadId) await assertOrganizationMember(update.teamLeadId, current.orgId);
    const team = await teamsRepository.update(teamId, update);
    if (!team) throw new NotFoundError('Team not found');
    return team;
  },

  async createSubTeam(parentTeamId: string, creatorId: string, name: string, teamLeadId?: string) {
    const parent = await this.get(parentTeamId);
    if (parent.parentTeamId) throw new ValidationError('Cannot create a sub-team under a sub-team');
    const leadId = teamLeadId ?? creatorId;
    await assertOrganizationMember(leadId, parent.orgId);
    return teamsRepository.create({ orgId: parent.orgId, name, teamLeadId: leadId, parentTeamId });
  },

  async listMembers(teamId: string) {
    await this.get(teamId);
    return teamsRepository.listMembers(teamId);
  },
  async listAvailableDevelopers(teamId: string) {
    const team = await this.get(teamId);
    return teamsRepository.listActiveDevelopers(team.orgId);
  },
  async addDeveloper(teamId: string, userId: string) {
    const team = await this.get(teamId);
    if (team.status !== 'active') throw new ValidationError('Archived teams cannot be changed');
    if (!(await teamsRepository.findActiveDeveloper(userId, team.orgId))) {
      throw new ValidationError('userId must identify an active Developer in this organization');
    }
    await teamsRepository.addMember(teamId, userId);
  },
  async removeDeveloper(teamId: string, userId: string) {
    const team = await this.get(teamId);
    if (team.status !== 'active') throw new ValidationError('Archived teams cannot be changed');
    await teamsRepository.removeMember(teamId, userId);
  },

  async requestDeletion(teamId: string, actor: AuthenticatedUser, mode: 'purge_now' | 'archive_15_days') {
    if (actor.role !== 'org_admin') throw new ForbiddenError('Only an Org Admin can delete a team');
    const team = await this.get(teamId);
    if (team.orgId !== actor.orgId) throw new ForbiddenError('Organization access denied');
    if (team.status === 'archived') throw new ValidationError('Team deletion is already scheduled');
    const now = new Date();
    const purgeAt = mode === 'archive_15_days' ? new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000) : null;
    const directAgents = await db.select({ id: agents.id, ownerUserId: agents.ownerUserId }).from(agents).where(eq(agents.teamId, teamId));
    const memberRows = await teamsRepository.listMembers(teamId);
    const recipientIds = new Set<string>([actor.id, ...directAgents.map((agent) => agent.ownerUserId), ...memberRows.map((member) => member.id)]);
    if (team.teamLeadId) recipientIds.add(team.teamLeadId);
    if (mode === 'archive_15_days') {
      const readers = await db.select({ id: users.id }).from(users).where(and(eq(users.orgId, team.orgId), eq(users.active, true), inArray(users.role, ['finance', 'auditor', 'org_admin'])));
      readers.forEach((reader) => recipientIds.add(reader.id));
    }
    const message = mode === 'archive_15_days'
      ? `Team '${team.name}' was archived. Its data is read-only for 15 days and will be permanently deleted on ${purgeAt!.toISOString()}.`
      : `Team '${team.name}' and its data were permanently deleted.`;
    const deletion = await db.transaction(async (tx) => {
      const [created] = await tx.insert(teamDeletions).values({ orgId: team.orgId, teamId, mode, requestedBy: actor.id, purgeAt }).returning();
      // Direct sub-teams remain independent, active top-level teams.
      await tx.update(teams).set({ parentTeamId: null, updatedAt: now }).where(eq(teams.parentTeamId, teamId));
      if (mode === 'archive_15_days') {
        await tx.update(agents).set({ status: 'paused', updatedAt: now }).where(eq(agents.teamId, teamId));
        await tx.update(teams).set({ status: 'archived', archivedAt: now, purgeAt, teamLeadId: null, updatedAt: now }).where(eq(teams.id, teamId));
        await tx.delete(teamMembers).where(eq(teamMembers.teamId, teamId));
      } else {
        await this.purgeTeamInTransaction(tx, team, created.id, actor.id, now);
      }
      await tx.insert(auditLog).values({ orgId: team.orgId, actorUserId: actor.id, eventType: mode === 'archive_15_days' ? 'team_archived' : 'team_deleted', targetType: 'team', targetId: teamId, metadata: { teamName: team.name, mode, deletedAt: now.toISOString(), purgeAt: purgeAt?.toISOString() } });
      return created;
    });
    await notificationsRepository.createInAppNotifications({ orgId: team.orgId, userIds: [...recipientIds], eventType: mode === 'archive_15_days' ? 'team_archived' : 'team_deleted', message });
    return deletion;
  },

  async purgeArchivedDeletion(deletionId: string) {
    const deletion = await teamsRepository.findDeletion(deletionId);
    if (!deletion || deletion.mode !== 'archive_15_days' || deletion.completedAt || !deletion.purgeAt || deletion.purgeAt > new Date()) return false;
    const team = await this.get(deletion.teamId);
    await db.transaction(async (tx) => {
      await this.purgeTeamInTransaction(tx, team, deletion.id, deletion.requestedBy, new Date());
    });
    return true;
  },

  async exportArchivedTeam(deletionId: string, actor: AuthenticatedUser) {
    if (!['org_admin', 'finance', 'auditor'].includes(actor.role)) throw new ForbiddenError('Archived team data is read-only for Org Admin, Finance, and Auditor roles only');
    const deletion = await teamsRepository.findDeletion(deletionId);
    if (!deletion || deletion.orgId !== actor.orgId || deletion.mode !== 'archive_15_days' || deletion.completedAt) throw new NotFoundError('Archived team not found');
    const team = await this.get(deletion.teamId);
    const rows = await db.select({ agentName: agents.name, createdAt: usageEvents.createdAt, provider: usageEvents.provider, model: usageEvents.model, inputTokens: usageEvents.inputTokens, outputTokens: usageEvents.outputTokens, costUsd: usageEvents.costUsd, status: usageEvents.status })
      .from(usageEvents).innerJoin(agents, eq(usageEvents.agentId, agents.id)).where(eq(agents.teamId, team.id));
    const csv = [['team', 'agent', 'timestamp', 'provider', 'model', 'input_tokens', 'output_tokens', 'cost_usd', 'status'], ...rows.map((row) => [team.name, row.agentName, row.createdAt.toISOString(), row.provider, row.model, row.inputTokens, row.outputTokens, row.costUsd, row.status])]
      .map((row) => row.map((value) => { const text = String(value ?? ''); return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }).join(',')).join('\n');
    return { team, csv };
  },

  async listArchivedDeletions(actor: AuthenticatedUser) {
    if (!actor.orgId || !['org_admin', 'finance', 'auditor'].includes(actor.role)) {
      throw new ForbiddenError('Archived team data is read-only for Org Admin, Finance, and Auditor roles only');
    }
    return teamsRepository.listPendingArchives(actor.orgId);
  },

  async purgeExpiredArchives(now = new Date()) {
    const deletions = await teamsRepository.findExpiredArchives(now);
    let purged = 0;
    for (const deletion of deletions) if (await this.purgeArchivedDeletion(deletion.id)) purged += 1;
    return purged;
  },

  async purgeTeamInTransaction(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], team: { id: string; orgId: string }, deletionId: string, actorId: string, now: Date) {
    const directAgents = await tx.select({ id: agents.id }).from(agents).where(eq(agents.teamId, team.id));
    const agentIds = directAgents.map((agent) => agent.id);
    if (agentIds.length) {
      const agentBudgetRows = await tx.select({ id: budgets.id }).from(budgets).where(and(eq(budgets.scope, 'agent'), inArray(budgets.scopeId, agentIds)));
      if (agentBudgetRows.length) await tx.delete(budgetRequests).where(inArray(budgetRequests.budgetId, agentBudgetRows.map((row) => row.id)));
      if (agentBudgetRows.length) await tx.delete(budgets).where(inArray(budgets.id, agentBudgetRows.map((row) => row.id)));
      await tx.delete(agentDeletions).where(inArray(agentDeletions.agentId, agentIds));
      await tx.delete(agents).where(inArray(agents.id, agentIds));
    }
    const teamBudgetRows = await tx.select({ id: budgets.id }).from(budgets).where(and(eq(budgets.scope, 'team'), eq(budgets.scopeId, team.id)));
    if (teamBudgetRows.length) await tx.delete(budgetRequests).where(inArray(budgetRequests.budgetId, teamBudgetRows.map((row) => row.id)));
    if (teamBudgetRows.length) await tx.delete(budgets).where(inArray(budgets.id, teamBudgetRows.map((row) => row.id)));
    const teamAlerts = await tx.select({ id: alerts.id }).from(alerts).where(eq(alerts.teamId, team.id));
    if (teamAlerts.length) await tx.delete(alertHistory).where(inArray(alertHistory.alertId, teamAlerts.map((alert) => alert.id)));
    if (teamAlerts.length) await tx.delete(alerts).where(inArray(alerts.id, teamAlerts.map((alert) => alert.id)));
    await tx.update(teams).set({ parentTeamId: null, updatedAt: now }).where(eq(teams.parentTeamId, team.id));
    await tx.delete(teams).where(eq(teams.id, team.id));
  },
};

import { randomBytes, randomUUID } from 'crypto';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import path from 'path';
import { AuthenticatedUser } from '../../middleware/auth';
import { canAccessAgent } from '../../middleware/rbac';
import { ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors';
import { agentsRepository } from './agents.repository';
import { auditRepository } from '../audit/audit.repository';

function maskApiKey(apiKey: string) {
  return `${apiKey.slice(0, 4)}****${apiKey.slice(-4)}`;
}
const exportsDirectory = path.resolve(process.cwd(), 'exports');

function csvEscape(value: unknown) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function writeUsageExport(agentId: string, deletionId: string) {
  const history = await agentsRepository.usageHistoryForExport(agentId);
  const rows = [
    ['timestamp', 'provider', 'model', 'input_tokens', 'output_tokens', 'cost_usd', 'status'],
    ...history.map((row) => [
      row.createdAt.toISOString(),
      row.provider,
      row.model,
      row.inputTokens,
      row.outputTokens,
      row.costUsd,
      row.status,
    ]),
  ];
  await mkdir(exportsDirectory, { recursive: true });
  const filePath = path.join(exportsDirectory, `${deletionId}.csv`);
  await writeFile(filePath, rows.map((row) => row.map(csvEscape).join(',')).join('\n'), 'utf8');
  return filePath;
}
function publicAgent(
  agent: Awaited<ReturnType<typeof agentsRepository.findById>>,
  expiresAt?: Date,
  approvalStatus?: string
) {
  if (!agent) return null;
  const { apiKey, ...rest } = agent;
  return {
    ...rest,
    apiKeyMasked: maskApiKey(apiKey),
    ...(approvalStatus && { approvalStatus }),
    ...(expiresAt && { approvalExpiresAt: expiresAt }),
  };
}

async function withApprovalState(
  agent: NonNullable<Awaited<ReturnType<typeof agentsRepository.findById>>>
) {
  const approval =
    agent.status === 'pending_approval' ? await agentsRepository.latestApproval(agent.id) : null;
  const expired = approval?.status === 'pending' && approval.expiresAt < new Date();
  return publicAgent(agent, approval?.expiresAt, expired ? 'expired' : approval?.status);
}

export const agentsService = {
  async register(user: AuthenticatedUser, name: string, teamId: string) {
    const team = await agentsRepository.findTeam(teamId);
    if (!team) throw new NotFoundError('Team not found');
    if (team.orgId !== user.orgId) throw new ForbiddenError('Organization access denied');
    const apiKey = `agt_${randomBytes(24).toString('hex')}`;
    const { agent } = await agentsRepository.create({
      orgId: team.orgId,
      teamId,
      ownerUserId: user.id,
      name,
      apiKey,
    });
    await auditRepository.record({
      orgId: team.orgId,
      actorUserId: user.id,
      eventType: 'agent_added',
      targetType: 'agent',
      targetId: agent.id,
      metadata: { name, teamId },
    });
    return { ...publicAgent(agent), apiKey };
  },

  async get(agentId: string) {
    const agent = await agentsRepository.findById(agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    return withApprovalState(agent);
  },
  async list(user: AuthenticatedUser) {
    const agents =
      user.role === 'org_admin'
        ? await agentsRepository.listByOrganization(user.orgId!)
        : user.role === 'team_lead'
          ? await agentsRepository.listByTeams(await agentsRepository.listTeamIdsLedBy(user.id))
          : await agentsRepository.listByOwner(user.id);
    return Promise.all(agents.map(withApprovalState));
  },
  async assertAgentAccess(user: AuthenticatedUser, agentId: string) {
    if (!(await canAccessAgent(user, agentId))) throw new ForbiddenError('Agent access denied');
  },
  async approve(agentId: string, actor: AuthenticatedUser) {
    const agent = await agentsRepository.findById(agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    if (agent.status !== 'pending_approval')
      throw new ValidationError('Only pending agents can be approved');
    const approval = await agentsRepository.latestApproval(agentId);
    if (!approval || approval.status !== 'pending')
      throw new ValidationError('No pending approval request exists');
    if (approval.expiresAt < new Date())
      throw new ValidationError('Agent approval request has expired');
    await agentsRepository.decideApproval(approval.id, 'approved', actor.id);
    await auditRepository.record({
      orgId: agent.orgId,
      actorUserId: actor.id,
      eventType: 'agent_approved',
      targetType: 'agent',
      targetId: agent.id,
      metadata: { name: agent.name },
    });
    return publicAgent(await agentsRepository.updateStatus(agentId, 'active', actor.id));
  },
  async reject(agentId: string, actor: AuthenticatedUser, reason?: string) {
    const agent = await agentsRepository.findById(agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    if (agent.status !== 'pending_approval')
      throw new ValidationError('Only pending agents can be rejected');
    const approval = await agentsRepository.latestApproval(agentId);
    if (!approval || approval.status !== 'pending')
      throw new ValidationError('No pending approval request exists');
    await agentsRepository.decideApproval(approval.id, 'rejected', actor.id);
    await agentsRepository.recordRejection(agent.orgId, agent.id, actor.id, reason);
    // agent_status deliberately has no rejected state; rejection lives on agent_approvals.
    return withApprovalState(agent);
  },
  async changePausedState(agentId: string, paused: boolean, actor?: AuthenticatedUser) {
    const agent = await agentsRepository.findById(agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    if (paused && agent.status !== 'active')
      throw new ValidationError('Only active agents can be paused');
    if (!paused && agent.status !== 'paused')
      throw new ValidationError('Only paused agents can be resumed');
    const updated = await agentsRepository.updateStatus(agentId, paused ? 'paused' : 'active');
    if (actor)
      await auditRepository.record({
        orgId: agent.orgId,
        actorUserId: actor.id,
        eventType: paused ? 'agent_paused' : 'agent_resumed',
        targetType: 'agent',
        targetId: agent.id,
        metadata: { name: agent.name },
      });
    return publicAgent(updated);
  },

  async requestDeletion(agentId: string, requester: AuthenticatedUser) {
    const agent = await agentsRepository.findById(agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    if (agent.status === 'pending_deletion')
      throw new ValidationError('Agent deletion is already pending');
    if (agent.teamId && !(await canAccessAgent(requester, agentId)))
      throw new ForbiddenError('Agent access denied');
    const team = agent.teamId ? await agentsRepository.findTeam(agent.teamId) : null;
    const recipientUserId = team?.teamLeadId ?? requester.id;
    const deletionId = randomUUID();
    const filePath = await writeUsageExport(agent.id, deletionId);
    try {
      const deletion = await agentsRepository.createDeletion({
        id: deletionId,
        orgId: agent.orgId,
        agentId: agent.id,
        csvExportUrl: filePath,
        recipientUserId,
      });
      await agentsRepository.updateStatus(agent.id, 'pending_deletion');
      await auditRepository.record({
        orgId: agent.orgId,
        actorUserId: requester.id,
        eventType: 'agent_deletion_requested',
        targetType: 'agent',
        targetId: agent.id,
        metadata: { name: agent.name },
      });
      return {
        id: deletion.id,
        recipientUserId: deletion.recipientUserId,
        requestedAt: deletion.requestedAt,
      };
    } catch (error) {
      await rm(filePath, { force: true });
      throw error;
    }
  },

  async downloadDeletionExport(deletionId: string, userId: string) {
    const deletion = await agentsRepository.findDeletion(deletionId);
    if (!deletion) throw new NotFoundError('Deletion request not found');
    if (deletion.recipientUserId !== userId)
      throw new ForbiddenError('Deletion export access denied');
    if (!deletion.csvExportUrl) throw new NotFoundError('Deletion export not found');
    try {
      return { deletion, content: await readFile(deletion.csvExportUrl) };
    } catch {
      throw new NotFoundError('Deletion export not found');
    }
  },

  async confirmDeletion(deletionId: string, recipientUserId: string) {
    const deletion = await agentsRepository.findDeletion(deletionId);
    if (!deletion) throw new NotFoundError('Deletion request not found');
    if (deletion.recipientUserId !== recipientUserId)
      throw new ForbiddenError('Only the assigned deletion recipient can confirm');
    if (deletion.confirmed)
      throw new ValidationError('Deletion request has already been confirmed');
    const agent = await agentsRepository.findById(deletion.agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    const approvalFacts = await agentsRepository.approvalFacts(agent.id);
    await agentsRepository.confirmAndDelete({
      deletionId,
      agent,
      deletedBy: recipientUserId,
      approvalFacts,
    });
    if (deletion.csvExportUrl) await rm(deletion.csvExportUrl, { force: true });
  },

  listMyPendingDeletions: (userId: string) =>
    agentsRepository.listPendingDeletionsForRecipient(userId),

  // Future scheduler hook: delivery is intentionally outside this module.
  findDeletionReminders: (now = new Date()) =>
    agentsRepository.findUnconfirmedDeletionReminders(
      new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)
    ),
};

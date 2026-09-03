import { AuthenticatedUser } from '../../middleware/auth';
import { canAccessAgent, canAccessTeam } from '../../middleware/rbac';
import { ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors';
import { agentsRepository } from '../agents/agents.repository';
import { auditRepository } from '../audit/audit.repository';
import { AlertRecord, AlertScope, AlertType, alertsRepository } from './alerts.repository';

export async function assertAlertAccess(user: AuthenticatedUser, alert: AlertRecord) {
  if (alert.orgId !== user.orgId) throw new ForbiddenError('Organization access denied');
  if (user.role === 'org_admin') return;
  if (alert.agentId && (await canAccessAgent(user, alert.agentId))) return;
  if (alert.teamId && (await canAccessTeam(user, alert.teamId))) return;
  throw new ForbiddenError('Alert access denied');
}

export const alertsService = {
  async create(
    user: AuthenticatedUser,
    input: { type: AlertType; scope: AlertScope; scopeId: string; thresholdPercent: number }
  ) {
    if (input.scope === 'org') {
      if (input.scopeId !== user.orgId) throw new ForbiddenError('Organization access denied');
      if (user.role !== 'org_admin')
        throw new ForbiddenError('Team Leads cannot create organization alerts');
    }
    if (input.scope === 'team' && !(await canAccessTeam(user, input.scopeId)))
      throw new ForbiddenError('Team access denied');
    if (input.scope === 'agent') {
      const agent = await agentsRepository.findById(input.scopeId);
      if (!agent) throw new NotFoundError('Agent not found');
      if (agent.orgId !== user.orgId) throw new ForbiddenError('Organization access denied');
      if (!(await canAccessAgent(user, input.scopeId)))
        throw new ForbiddenError('Agent access denied');
    }
    const alert = await alertsRepository.create({ ...input, orgId: user.orgId! });
    await auditRepository.record({
      orgId: user.orgId!,
      actorUserId: user.id,
      eventType: 'alert_added',
      targetType: 'alert',
      targetId: alert.id,
      metadata: { scope: input.scope, type: input.type },
    });
    return alert;
  },
  async list(user: AuthenticatedUser) {
    if (user.role === 'org_admin') return alertsRepository.listByOrganization(user.orgId!);
    if (user.role === 'team_lead') {
      const teamIds = await agentsRepository.listTeamIdsLedBy(user.id);
      const agentIds = (
        await Promise.all(teamIds.map((teamId) => agentsRepository.listByTeams([teamId])))
      )
        .flat()
        .map((agent) => agent.id);
      return alertsRepository.listByTeamsAndAgents(user.orgId!, teamIds, agentIds);
    }
    return alertsRepository.listByTeamsAndAgents(
      user.orgId!,
      [],
      (await agentsRepository.listByOwner(user.id)).map((agent) => agent.id)
    );
  },
  async update(
    user: AuthenticatedUser,
    alertId: string,
    update: { thresholdPercent?: number; active?: boolean }
  ) {
    const alert = await alertsRepository.findById(alertId);
    if (!alert) throw new NotFoundError('Alert not found');
    await assertAlertAccess(user, alert);
    const updated = await alertsRepository.update(alertId, update);
    if (updated)
      await auditRepository.record({
        orgId: alert.orgId,
        actorUserId: user.id,
        eventType:
          update.active === false
            ? 'alert_disabled'
            : update.active === true
              ? 'alert_enabled'
              : 'alert_updated',
        targetType: 'alert',
        targetId: alertId,
      });
    return updated;
  },
  async listHistory(user: AuthenticatedUser, status?: 'triggered' | 'acknowledged' | 'resolved') {
    const visibleAlerts = await this.list(user);
    return alertsRepository.listHistory(
      visibleAlerts.map((alert) => alert.id),
      status
    );
  },
  async acknowledge(user: AuthenticatedUser, historyId: string) {
    const history = await alertsRepository.findHistoryWithAlert(historyId);
    if (!history) throw new NotFoundError('Alert history not found');
    await assertAlertAccess(user, {
      id: history.alertId,
      orgId: history.orgId,
      teamId: history.teamId,
      agentId: history.agentId,
      type: history.type,
      thresholdPercent: 0,
      active: true,
    });
    if (history.status !== 'triggered')
      throw new ValidationError('Only triggered alerts can be acknowledged');
    const acknowledged = await alertsRepository.acknowledgeHistory(historyId, user.id);
    await auditRepository.record({
      orgId: history.orgId,
      actorUserId: user.id,
      eventType: 'alert_acknowledged',
      targetType: 'alert',
      targetId: history.alertId,
      metadata: { historyId },
    });
    return acknowledged;
  },
};

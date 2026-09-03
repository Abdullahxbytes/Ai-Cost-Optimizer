import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../config/database';
import { agents } from '../agents/agents.schema.db';
import { teams } from '../teams/teams.schema.db';
import { users } from '../user/user.schema.db';
import { alertHistory, alerts } from './alerts.schema.db';

export type AlertType = 'budget' | 'spike' | 'runaway';
export type AlertScope = 'org' | 'team' | 'agent';
export type AlertRecord = {
  id: string;
  orgId: string;
  teamId: string | null;
  agentId: string | null;
  type: AlertType;
  thresholdPercent: number;
  active: boolean;
};
export type AlertHistoryStatus = 'triggered' | 'acknowledged' | 'resolved';
const alertFields = { id: alerts.id, orgId: alerts.orgId, teamId: alerts.teamId, agentId: alerts.agentId, type: alerts.type, thresholdPercent: alerts.thresholdPercent, active: alerts.active };
function toAlert(row: Omit<AlertRecord, 'thresholdPercent'> & { thresholdPercent: string }): AlertRecord { return { ...row, thresholdPercent: Number(row.thresholdPercent) }; }

export const alertsRepository = {
  async create(input: { orgId: string; scope: AlertScope; scopeId: string; type: AlertType; thresholdPercent: number }) {
    const [alert] = await db.insert(alerts).values({
      orgId: input.orgId,
      teamId: input.scope === 'team' ? input.scopeId : null,
      agentId: input.scope === 'agent' ? input.scopeId : null,
      type: input.type,
      thresholdPercent: String(input.thresholdPercent),
      active: true,
    }).returning(alertFields);
    return toAlert(alert as never);
  },
  async findById(alertId: string): Promise<AlertRecord | null> {
    const [alert] = await db.select(alertFields).from(alerts).where(eq(alerts.id, alertId)).limit(1);
    return alert ? toAlert(alert as never) : null;
  },
  async update(alertId: string, update: { thresholdPercent?: number; active?: boolean }): Promise<AlertRecord | null> {
    const [alert] = await db.update(alerts).set({
      ...(update.thresholdPercent !== undefined && { thresholdPercent: String(update.thresholdPercent) }),
      ...(update.active !== undefined && { active: update.active }),
      updatedAt: new Date(),
    }).where(eq(alerts.id, alertId)).returning(alertFields);
    return alert ? toAlert(alert as never) : null;
  },
  async listByOrganization(orgId: string) {
    return (await db.select(alertFields).from(alerts).where(eq(alerts.orgId, orgId))).map((alert) => toAlert(alert as never));
  },
  async listByTeamsAndAgents(orgId: string, teamIds: string[], agentIds: string[]) {
    const teamAlerts = teamIds.length ? await db.select(alertFields).from(alerts).where(and(eq(alerts.orgId, orgId), inArray(alerts.teamId, teamIds))) : [];
    const agentAlerts = agentIds.length ? await db.select(alertFields).from(alerts).where(and(eq(alerts.orgId, orgId), inArray(alerts.agentId, agentIds))) : [];
    return [...teamAlerts, ...agentAlerts].map((alert) => toAlert(alert as never));
  },
  async listActiveBudgetAlerts(): Promise<AlertRecord[]> {
    const rows = await db
      .select(alertFields)
      .from(alerts)
      .where(and(eq(alerts.type, 'budget'), eq(alerts.active, true)));
    return rows.map((alert) => toAlert(alert as never));
  },
  async hasTriggeredHistory(alertId: string): Promise<boolean> {
    const [history] = await db
      .select({ id: alertHistory.id })
      .from(alertHistory)
      .where(and(eq(alertHistory.alertId, alertId), eq(alertHistory.status, 'triggered')))
      .limit(1);
    return Boolean(history);
  },
  async createTriggeredHistory(orgId: string, alertId: string) {
    const [history] = await db
      .insert(alertHistory)
      .values({ orgId, alertId, status: 'triggered' })
      .returning();
    return history;
  },
  async findHistoryWithAlert(historyId: string) {
    const [row] = await db
      .select({
        id: alertHistory.id, status: alertHistory.status, alertId: alerts.id, orgId: alerts.orgId,
        teamId: alerts.teamId, agentId: alerts.agentId, type: alerts.type,
      })
      .from(alertHistory)
      .innerJoin(alerts, eq(alertHistory.alertId, alerts.id))
      .where(eq(alertHistory.id, historyId))
      .limit(1);
    return row ?? null;
  },
  async acknowledgeHistory(historyId: string, userId: string) {
    const [history] = await db.update(alertHistory)
      .set({ status: 'acknowledged', acknowledgedBy: userId, acknowledgedAt: new Date() })
      .where(eq(alertHistory.id, historyId))
      .returning();
    return history ?? null;
  },
  async listHistory(alertIds: string[], status?: AlertHistoryStatus) {
    if (!alertIds.length) return [];
    return db
      .select({
        id: alertHistory.id,
        alertType: alerts.type,
        scope: sql<AlertScope>`case when ${alerts.teamId} is not null then 'team' when ${alerts.agentId} is not null then 'agent' else 'org' end`,
        scopeName: sql<string | null>`coalesce(${teams.name}, ${agents.name})`,
        thresholdPercent: alerts.thresholdPercent,
        triggeredAt: alertHistory.triggeredAt,
        status: alertHistory.status,
        acknowledgedBy: alertHistory.acknowledgedBy,
        acknowledgedByEmail: users.email,
        acknowledgedAt: alertHistory.acknowledgedAt,
      })
      .from(alertHistory)
      .innerJoin(alerts, eq(alertHistory.alertId, alerts.id))
      .leftJoin(teams, eq(alerts.teamId, teams.id))
      .leftJoin(agents, eq(alerts.agentId, agents.id))
      .leftJoin(users, eq(alertHistory.acknowledgedBy, users.id))
      .where(and(inArray(alertHistory.alertId, alertIds), ...(status ? [eq(alertHistory.status, status)] : [])))
      .orderBy(desc(alertHistory.triggeredAt));
  },
  async scopeLabel(alert: AlertRecord) {
    if (alert.teamId) {
      const [team] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, alert.teamId)).limit(1);
      return `Team '${team?.name ?? alert.teamId}'`;
    }
    return alert.agentId ? `Agent '${alert.agentId}'` : 'Organization';
  },
};

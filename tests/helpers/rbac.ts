import bcrypt from 'bcrypt';
import { db } from '../../src/config/database';
import { agents } from '../../src/features/agents/agents.schema.db';
import { alerts, alertHistory } from '../../src/features/alerts/alerts.schema.db';
import { auditLog } from '../../src/features/audit/audit.schema.db';
import { budgets } from '../../src/features/budgets/budgets.schema.db';
import { orgs } from '../../src/features/orgs/orgs.schema.db';
import { orgProviderKeys } from '../../src/features/provider-keys/provider-keys.schema.db';
import { teams } from '../../src/features/teams/teams.schema.db';
import { superAdmins, users } from '../../src/features/user/user.schema.db';
import { hashAgentKey } from '../../src/utils/agentKey';
import { superAdminToken, tenantToken } from './auth';

const passwordHash = () => bcrypt.hash('CorrectPassword9!', 12);

export async function seedRbacFixture() {
  const [orgA] = await db.insert(orgs).values({ name: 'RBAC Org A', timezone: 'UTC' }).returning();
  const [orgB] = await db.insert(orgs).values({ name: 'RBAC Org B', timezone: 'UTC' }).returning();
  const [adminA, leadA, leadB, subLead, developerA, developerB, financeA, auditorA] = await db.insert(users).values([
    { orgId: orgA.id, email: 'admin-a@example.test', passwordHash: await passwordHash(), role: 'org_admin' },
    { orgId: orgA.id, email: 'lead-a@example.test', passwordHash: await passwordHash(), role: 'team_lead' },
    { orgId: orgA.id, email: 'lead-b@example.test', passwordHash: await passwordHash(), role: 'team_lead' },
    { orgId: orgA.id, email: 'sub-lead@example.test', passwordHash: await passwordHash(), role: 'team_lead' },
    { orgId: orgA.id, email: 'developer-a@example.test', passwordHash: await passwordHash(), role: 'developer' },
    { orgId: orgA.id, email: 'developer-b@example.test', passwordHash: await passwordHash(), role: 'developer' },
    { orgId: orgA.id, email: 'finance-a@example.test', passwordHash: await passwordHash(), role: 'finance' },
    { orgId: orgA.id, email: 'auditor-a@example.test', passwordHash: await passwordHash(), role: 'auditor' },
  ]).returning();
  const [adminB] = await db.insert(users).values({ orgId: orgB.id, email: 'admin-b@example.test', passwordHash: await passwordHash(), role: 'org_admin' }).returning();
  const [superAdmin] = await db.insert(superAdmins).values({ email: 'rbac-super@example.test', passwordHash: await passwordHash() }).returning();

  const [teamA, teamB] = await db.insert(teams).values([
    { orgId: orgA.id, name: 'Team A', teamLeadId: leadA.id },
    { orgId: orgA.id, name: 'Team B', teamLeadId: leadB.id },
  ]).returning();
  const [subTeam] = await db.insert(teams).values({ orgId: orgA.id, name: 'Team A Sub', parentTeamId: teamA.id, teamLeadId: subLead.id }).returning();
  const [teamBExternal] = await db.insert(teams).values({ orgId: orgB.id, name: 'Team B External', teamLeadId: adminB.id }).returning();

  const [agentA, agentOther, agentSub, agentExternal] = await db.insert(agents).values([
    { orgId: orgA.id, teamId: teamA.id, ownerUserId: developerA.id, name: 'Agent A', apiKey: hashAgentKey('agent-a'), status: 'active' },
    { orgId: orgA.id, teamId: teamA.id, ownerUserId: developerB.id, name: 'Agent Other', apiKey: hashAgentKey('agent-other'), status: 'active' },
    { orgId: orgA.id, teamId: subTeam.id, ownerUserId: developerB.id, name: 'Agent Sub', apiKey: hashAgentKey('agent-sub'), status: 'active' },
    { orgId: orgB.id, teamId: teamBExternal.id, ownerUserId: adminB.id, name: 'Agent External', apiKey: hashAgentKey('agent-external'), status: 'active' },
  ]).returning();

  const [teamBudget, otherTeamBudget, agentBudget, externalBudget] = await db.insert(budgets).values([
    { orgId: orgA.id, scope: 'team', scopeId: teamA.id, limitAmount: '100', period: 'monthly', resetTimezone: 'UTC' },
    { orgId: orgA.id, scope: 'team', scopeId: teamB.id, limitAmount: '100', period: 'monthly', resetTimezone: 'UTC' },
    { orgId: orgA.id, scope: 'agent', scopeId: agentA.id, limitAmount: '50', period: 'monthly', resetTimezone: 'UTC' },
    { orgId: orgB.id, scope: 'team', scopeId: teamBExternal.id, limitAmount: '100', period: 'monthly', resetTimezone: 'UTC' },
  ]).returning();
  const [teamAlert, otherTeamAlert, externalAlert] = await db.insert(alerts).values([
    { orgId: orgA.id, teamId: teamA.id, type: 'budget', thresholdPercent: '80', active: true },
    { orgId: orgA.id, teamId: teamB.id, type: 'budget', thresholdPercent: '80', active: true },
    { orgId: orgB.id, teamId: teamBExternal.id, type: 'budget', thresholdPercent: '80', active: true },
  ]).returning();
  const [externalHistory] = await db.insert(alertHistory).values({ orgId: orgB.id, alertId: externalAlert.id, status: 'triggered' }).returning();
  await db.insert(auditLog).values([
    { orgId: orgA.id, actorUserId: adminA.id, eventType: 'rbac_fixture', targetType: 'team', targetId: teamA.id, metadata: {} },
    { orgId: orgB.id, actorUserId: adminB.id, eventType: 'rbac_fixture', targetType: 'team', targetId: teamBExternal.id, metadata: {} },
  ]);
  await db.insert(orgProviderKeys).values({ orgId: orgB.id, provider: 'gemini', encryptedKey: 'test-ciphertext', keyLastFour: '1234', addedBy: adminB.id });

  return {
    orgA, orgB, users: { adminA, leadA, leadB, subLead, developerA, developerB, financeA, auditorA, adminB }, superAdmin,
    teams: { teamA, teamB, subTeam, teamBExternal }, agents: { agentA, agentOther, agentSub, agentExternal },
    budgets: { teamBudget, otherTeamBudget, agentBudget, externalBudget }, alerts: { teamAlert, otherTeamAlert, externalAlert, externalHistory },
    token: (user: typeof adminA) => tenantToken(user), superToken: () => superAdminToken(superAdmin),
  };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

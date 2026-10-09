import 'dotenv/config';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { eq, inArray } from 'drizzle-orm';
import { client, db } from '../src/config/database';
import { env } from '../src/config/env';
import { agents } from '../src/features/agents/agents.schema.db';
import { auditLog } from '../src/features/audit/audit.schema.db';
import { notifications } from '../src/features/notifications/notifications.schema.db';
import { usageEvents } from '../src/features/proxy/proxy.schema.db';
import { teamDeletions, teamMembers, teams } from '../src/features/teams/teams.schema.db';
import { orgs } from '../src/features/orgs/orgs.schema.db';
import { users } from '../src/features/user/user.schema.db';
import { hashAgentKey } from '../src/utils/agentKey';

const baseUrl = 'http://127.0.0.1:3000';
type Role = 'org_admin' | 'team_lead' | 'developer' | 'finance' | 'auditor';
const request = async (path: string, token: string, init: RequestInit = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  return { status: response.status, body: await response.text() };
};

async function main() {
  const id = randomUUID();
  let orgId = '';
  const userIds: string[] = [];
  const agentIds: string[] = [];
  try {
    const [org] = await db
      .insert(orgs)
      .values({ name: `Team lifecycle ${id}`, timezone: 'UTC' })
      .returning();
    orgId = org.id;
    const makeUser = async (role: Role) => {
      const [user] = await db
        .insert(users)
        .values({ orgId, email: `${role}-${id}@example.test`, passwordHash: 'test', role })
        .returning();
      userIds.push(user.id);
      return user;
    };
    const admin = await makeUser('org_admin');
    const lead = await makeUser('team_lead');
    const developer = await makeUser('developer');
    const finance = await makeUser('finance');
    await makeUser('auditor');
    const token = (user: { id: string; role: Role }) =>
      jwt.sign(
        { user_id: user.id, org_id: orgId, role: user.role, token_version: 0 },
        env.JWT_SECRET,
        { expiresIn: '5m' }
      );
    const adminToken = token(admin);
    const leadToken = token(lead);
    const devToken = token(developer);
    const financeToken = token(finance);
    const top = await request('/teams', adminToken, {
      method: 'POST',
      body: JSON.stringify({ name: 'Archive parent', teamLeadId: lead.id }),
    });
    const topTeam = JSON.parse(top.body);
    const sub = await request(`/teams/${topTeam.id}/sub-teams`, adminToken, {
      method: 'POST',
      body: JSON.stringify({ name: 'Independent sub-team', teamLeadId: lead.id }),
    });
    const subTeam = JSON.parse(sub.body);
    const member = await request(`/teams/${topTeam.id}/members`, leadToken, {
      method: 'POST',
      body: JSON.stringify({ userId: developer.id }),
    });
    const rawKey = `agt_${randomUUID().replaceAll('-', '')}`;
    const [archiveAgent] = await db
      .insert(agents)
      .values({
        orgId,
        teamId: topTeam.id,
        ownerUserId: developer.id,
        name: 'Archive agent',
        apiKey: hashAgentKey(rawKey),
        status: 'active',
        approvedAt: new Date(),
        approvedBy: admin.id,
      })
      .returning();
    agentIds.push(archiveAgent.id);
    await db.insert(usageEvents).values({
      orgId,
      agentId: archiveAgent.id,
      taskId: randomUUID(),
      provider: 'gemini',
      model: 'test-model',
      callType: 'llm_call',
      environment: 'dev',
      inputTokens: 7,
      outputTokens: 3,
      costUsd: '0.0100',
      latencyMs: 1,
      status: 'success',
      isTest: true,
      cacheHit: false,
    });
    const archive = await request(`/teams/${topTeam.id}/deletion`, adminToken, {
      method: 'POST',
      body: JSON.stringify({ mode: 'archive_15_days' }),
    });
    const archiveDeletion = JSON.parse(archive.body);
    const devTeams = await request('/teams', devToken);
    const proxy = await fetch(
      `${baseUrl}/proxy/gemini/v1beta/models/gemini-2.0-flash:generateContent`,
      {
        method: 'POST',
        headers: { 'x-agent-key': rawKey, 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'blocked because archived' }] }] }),
      }
    );
    const archiveList = await request('/team-deletions', financeToken);
    const exportResult = await request(
      `/team-deletions/${archiveDeletion.id}/export`,
      financeToken
    );
    const [archivedTeam] = await db.select().from(teams).where(eq(teams.id, topTeam.id));
    const [reparentedSub] = await db.select().from(teams).where(eq(teams.id, subTeam.id));
    const [pausedAgent] = await db.select().from(agents).where(eq(agents.id, archiveAgent.id));

    const purgeTeamResponse = await request('/teams', adminToken, {
      method: 'POST',
      body: JSON.stringify({ name: 'Purge team', teamLeadId: lead.id }),
    });
    const purgeTeam = JSON.parse(purgeTeamResponse.body);
    const [purgeAgent] = await db
      .insert(agents)
      .values({
        orgId,
        teamId: purgeTeam.id,
        ownerUserId: developer.id,
        name: 'Purge agent',
        apiKey: hashAgentKey(`agt_${randomUUID().replaceAll('-', '')}`),
        status: 'active',
        approvedAt: new Date(),
        approvedBy: admin.id,
      })
      .returning();
    agentIds.push(purgeAgent.id);
    await db.insert(usageEvents).values({
      orgId,
      agentId: purgeAgent.id,
      taskId: randomUUID(),
      provider: 'gemini',
      model: 'test-model',
      callType: 'llm_call',
      environment: 'dev',
      inputTokens: 5,
      outputTokens: 2,
      costUsd: '0.0020',
      latencyMs: 1,
      status: 'success',
      isTest: true,
      cacheHit: false,
    });
    const purge = await request(`/teams/${purgeTeam.id}/deletion`, adminToken, {
      method: 'POST',
      body: JSON.stringify({ mode: 'purge_now' }),
    });
    const purgedAgent = await db
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.id, purgeAgent.id));
    const purgedUsage = await db
      .select({ id: usageEvents.id })
      .from(usageEvents)
      .where(eq(usageEvents.agentId, purgeAgent.id));
    const audit = await db
      .select({ eventType: auditLog.eventType })
      .from(auditLog)
      .where(eq(auditLog.orgId, orgId));
    const noticeCount = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(eq(notifications.orgId, orgId));
    console.log(
      JSON.stringify(
        {
          memberAdd: member.status,
          archive: archive.status,
          archived: {
            teamStatus: archivedTeam?.status,
            agentStatus: pausedAgent?.status,
            subTeamStatus: reparentedSub?.status,
            subTeamParent: reparentedSub?.parentTeamId,
          },
          developerTeamsAfterArchive: devTeams,
          archivedAgentProxyStatus: proxy.status,
          financeArchiveList: archiveList.status,
          financeCsv: {
            status: exportResult.status,
            containsUsage: exportResult.body.includes('gemini'),
          },
          immediatePurge: {
            status: purge.status,
            agentRows: purgedAgent.length,
            usageRows: purgedUsage.length,
          },
          auditEvents: audit.map((row) => row.eventType),
          notificationCount: noticeCount.length,
        },
        null,
        2
      )
    );
  } finally {
    if (orgId) {
      await db.delete(teamMembers).where(inArraySafe(teamMembers.userId, userIds));
      await db.delete(teamDeletions).where(eq(teamDeletions.orgId, orgId));
      await db.delete(notifications).where(eq(notifications.orgId, orgId));
      await db.delete(auditLog).where(eq(auditLog.orgId, orgId));
      await db.delete(agents).where(eq(agents.orgId, orgId));
      await db.delete(teams).where(eq(teams.orgId, orgId));
      await db.delete(users).where(eq(users.orgId, orgId));
      await db.delete(orgs).where(eq(orgs.id, orgId));
    }
    await client.end();
  }
}
function inArraySafe(column: typeof teamMembers.userId, values: string[]) {
  return values.length === 1
    ? eq(column, values[0])
    : values.length
      ? inArray(column, values)
      : eq(column, '__none__');
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

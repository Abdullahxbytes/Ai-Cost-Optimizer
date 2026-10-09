import 'dotenv/config';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { and, eq } from 'drizzle-orm';
import { db, client } from '../src/config/database';
import { env } from '../src/config/env';
import { orgs } from '../src/features/orgs/orgs.schema.db';
import { users } from '../src/features/user/user.schema.db';
import { teams } from '../src/features/teams/teams.schema.db';
import { agents } from '../src/features/agents/agents.schema.db';
import { agentDeletions } from '../src/features/agents/agents.schema.db';
import { usageEvents } from '../src/features/proxy/proxy.schema.db';
import { auditLog } from '../src/features/audit/audit.schema.db';
import { hashAgentKey } from '../src/utils/agentKey';

const baseUrl = 'http://127.0.0.1:3000';
async function call(path: string, init: RequestInit, text = false) {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, body: text ? await response.text() : await response.json() };
}

async function main() {
  const suffix = randomUUID();
  let orgId: string | undefined;
  let userId: string | undefined;
  let agentId: string | undefined;
  try {
    const [org] = await db
      .insert(orgs)
      .values({ name: `Teams deletion ${suffix}`, timezone: 'UTC' })
      .returning();
    orgId = org.id;
    const [user] = await db
      .insert(users)
      .values({
        orgId,
        email: `teams-deletion-${suffix}@example.test`,
        passwordHash: 'unused',
        role: 'org_admin',
      })
      .returning();
    userId = user.id;
    const token = jwt.sign(
      { user_id: userId, org_id: orgId, role: 'org_admin', token_version: 0 },
      env.JWT_SECRET,
      { expiresIn: '5m' }
    );
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const top = await call('/teams', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Top-level' }),
    });
    const sub = await call(`/teams/${top.body.id}/sub-teams`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Sub-team' }),
    });
    const nested = await call(`/teams/${sub.body.id}/sub-teams`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Not allowed' }),
    });
    const [agent] = await db
      .insert(agents)
      .values({
        orgId,
        teamId: top.body.id,
        ownerUserId: userId,
        name: 'Deletion workflow agent',
        apiKey: hashAgentKey(`agt_${randomUUID().replaceAll('-', '')}`),
        status: 'active',
        approvedAt: new Date(),
        approvedBy: userId,
      })
      .returning();
    agentId = agent.id;
    await db.insert(usageEvents).values({
      orgId,
      agentId,
      taskId: randomUUID(),
      provider: 'gemini',
      model: 'test-model',
      callType: 'llm_call',
      environment: 'dev',
      inputTokens: 9,
      outputTokens: 4,
      costUsd: '0.0123',
      latencyMs: 10,
      status: 'success',
      isTest: true,
      cacheHit: false,
    });
    const requested = await call(`/agents/${agentId}/request-deletion`, {
      method: 'POST',
      headers,
      body: '{}',
    });
    const pending = await call('/agent-deletions', { method: 'GET', headers });
    const csv = await call(
      `/agent-deletions/${requested.body.id}/download`,
      { method: 'GET', headers },
      true
    );
    const confirmed = await call(`/agent-deletions/${requested.body.id}/confirm`, {
      method: 'POST',
      headers,
      body: '{}',
    });
    const agentRows = await db.select({ id: agents.id }).from(agents).where(eq(agents.id, agentId));
    const auditRows = await db
      .select({ eventType: auditLog.eventType })
      .from(auditLog)
      .where(and(eq(auditLog.orgId, orgId), eq(auditLog.eventType, 'agent_deleted')));
    console.log(
      JSON.stringify(
        {
          topLevel: top.status,
          subTeam: sub.status,
          nestedSubTeam: nested,
          deletionRequest: requested.status,
          pendingDeletionList: { status: pending.status, count: pending.body.length },
          csvDownload: {
            status: csv.status,
            hasUsageRow: csv.body.includes('gemini,test-model,9,4,0.0123,success'),
          },
          deletionConfirm: confirmed.status,
          agentRemaining: agentRows.length,
          deletionAuditRows: auditRows.length,
        },
        null,
        2
      )
    );
  } finally {
    if (orgId) await db.delete(agentDeletions).where(eq(agentDeletions.orgId, orgId));
    if (agentId) await db.delete(agents).where(eq(agents.id, agentId));
    if (orgId) await db.delete(teams).where(eq(teams.orgId, orgId));
    if (userId) await db.delete(users).where(eq(users.id, userId));
    if (orgId) await db.delete(orgs).where(eq(orgs.id, orgId));
    await client.end();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import 'dotenv/config';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { db, client } from '../src/config/database';
import { env } from '../src/config/env';
import { orgs } from '../src/features/orgs/orgs.schema.db';
import { users } from '../src/features/user/user.schema.db';
import { teams } from '../src/features/teams/teams.schema.db';
import { agents } from '../src/features/agents/agents.schema.db';
import { orgProviderKeys } from '../src/features/provider-keys/provider-keys.schema.db';
import { usageEvents } from '../src/features/proxy/proxy.schema.db';
import { hashAgentKey } from '../src/utils/agentKey';

const baseUrl = 'http://127.0.0.1:3000';
async function call(path: string, init: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    signal: AbortSignal.timeout(20_000),
  });
  return { status: response.status, body: await response.json() };
}
async function main() {
  let orgId: string | undefined;
  let userId: string | undefined;
  let teamId: string | undefined;
  let agentId: string | undefined;
  try {
    const rawKey = `agt_toggle_${randomUUID().replaceAll('-', '')}`;
    const [org] = await db
      .insert(orgs)
      .values({ name: `Optimization toggle ${randomUUID()}`, timezone: 'UTC' })
      .returning();
    orgId = org.id;
    const [user] = await db
      .insert(users)
      .values({
        orgId,
        email: `toggle-${randomUUID()}@example.test`,
        passwordHash: 'unused',
        role: 'org_admin',
      })
      .returning();
    userId = user.id;
    const [team] = await db
      .insert(teams)
      .values({ orgId, name: 'Toggle team', teamLeadId: userId })
      .returning();
    teamId = team.id;
    const [agent] = await db
      .insert(agents)
      .values({
        orgId,
        teamId,
        ownerUserId: userId,
        name: 'Toggle agent',
        apiKey: hashAgentKey(rawKey),
        status: 'active',
        approvedAt: new Date(),
        approvedBy: userId,
      })
      .returning();
    agentId = agent.id;
    const token = jwt.sign(
      { user_id: userId, org_id: orgId, role: 'org_admin', token_version: 0 },
      env.JWT_SECRET,
      { expiresIn: '5m' }
    );
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const key = await call(`/orgs/${orgId}/provider-keys`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ provider: 'gemini', apiKey: env.GEMINI_API_KEY }),
    });
    const on = await call(`/agents/${agentId}/optimization-settings`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        semanticCacheEnabled: true,
        cacheSimilarityThreshold: 0.92,
        cacheTtlSeconds: 3600,
      }),
    });
    const proxy = (taskId: string) =>
      call('/proxy/gemini/v1beta/models/gemini-3.6-flash:generateContent', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-agent-key': rawKey, 'x-task-id': taskId },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Reply with exactly: toggle-check.' }] }],
        }),
      });
    const firstTask = randomUUID();
    const secondTask = randomUUID();
    const thirdTask = randomUUID();
    const first = await proxy(firstTask);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const second = await proxy(secondTask);
    const off = await call(`/agents/${agentId}/optimization-settings`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ semanticCacheEnabled: false }),
    });
    const third = await proxy(thirdTask);
    const rows = await db
      .select({ taskId: usageEvents.taskId, cacheHit: usageEvents.cacheHit })
      .from(usageEvents)
      .where(eq(usageEvents.agentId, agentId));
    const secondHit = rows.find((row) => row.taskId === secondTask)?.cacheHit;
    const thirdHit = rows.find((row) => row.taskId === thirdTask)?.cacheHit;
    if (
      key.status !== 200 ||
      on.status !== 200 ||
      first.status !== 200 ||
      second.status !== 200 ||
      off.status !== 200 ||
      third.status !== 200 ||
      secondHit !== true ||
      thirdHit !== false
    )
      throw new Error(
        `Optimization toggle check failed: ${JSON.stringify({ key: key.status, on: on.status, first: first.status, second: second.status, off: off.status, third: third.status, secondHit, thirdHit })}`
      );
    console.log(
      JSON.stringify(
        {
          keyAdd: key.status,
          settingsEnabled: on.status,
          first: first.status,
          second: { status: second.status, cacheHit: secondHit },
          settingsDisabled: off.status,
          third: { status: third.status, cacheHit: thirdHit },
        },
        null,
        2
      )
    );
  } finally {
    if (agentId) await db.delete(agents).where(eq(agents.id, agentId));
    if (orgId) await db.delete(orgProviderKeys).where(eq(orgProviderKeys.orgId, orgId));
    if (teamId) await db.delete(teams).where(eq(teams.id, teamId));
    if (userId) await db.delete(users).where(eq(users.id, userId));
    if (orgId) await db.delete(orgs).where(eq(orgs.id, orgId));
    await client.end();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

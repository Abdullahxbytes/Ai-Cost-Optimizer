import 'dotenv/config';
import { randomUUID } from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { and, eq } from 'drizzle-orm';
import { db, client } from '../src/config/database';
import { env } from '../src/config/env';
import { orgs } from '../src/features/orgs/orgs.schema.db';
import { users } from '../src/features/user/user.schema.db';
import { teams } from '../src/features/teams/teams.schema.db';
import { agents } from '../src/features/agents/agents.schema.db';
import { orgProviderKeys } from '../src/features/provider-keys/provider-keys.schema.db';
import { usageEvents } from '../src/features/proxy/proxy.schema.db';
import { notifications } from '../src/features/notifications/notifications.schema.db';
import { hashAgentKey } from '../src/utils/agentKey';

const baseUrl = 'http://127.0.0.1:3000';
async function call(path: string, init: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, body: await response.json() };
}
async function main() {
  const suffix = randomUUID();
  const rawKey = `agt_ui_${randomUUID().replaceAll('-', '')}`;
  let orgId: string | undefined;
  let userId: string | undefined;
  let teamId: string | undefined;
  let agentId: string | undefined;
  try {
    const oldPassword = 'OldPassword9!';
    const newPassword = 'NewPassword9!';
    const [org] = await db
      .insert(orgs)
      .values({ name: `Final UI gaps ${suffix}`, timezone: 'UTC' })
      .returning();
    orgId = org.id;
    const [user] = await db
      .insert(users)
      .values({
        orgId,
        email: `final-ui-${suffix}@example.test`,
        passwordHash: await bcrypt.hash(oldPassword, 12),
        role: 'org_admin',
      })
      .returning();
    userId = user.id;
    const [team] = await db
      .insert(teams)
      .values({ orgId, name: 'UI settings team', teamLeadId: userId })
      .returning();
    teamId = team.id;
    const [agent] = await db
      .insert(agents)
      .values({
        orgId,
        teamId,
        ownerUserId: userId,
        name: 'Optimization agent',
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
    const profile = await call('/auth/me', { method: 'GET', headers });
    const keyAdd = await call(`/orgs/${orgId}/provider-keys`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ provider: 'gemini', apiKey: env.GEMINI_API_KEY }),
    });
    const settingsOn = await call(`/agents/${agentId}/optimization-settings`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        semanticCacheEnabled: true,
        promptOptimizationEnabled: true,
        cacheSimilarityThreshold: 0.92,
        cacheTtlSeconds: 3600,
      }),
    });
    const prompt = 'Reply with exactly: optimization-check.';
    const proxy = async (taskId: string) =>
      call('/proxy/gemini/v1beta/models/gemini-3.6-flash:generateContent', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-agent-key': rawKey, 'x-task-id': taskId },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
      });
    const firstTask = randomUUID();
    const secondTask = randomUUID();
    const thirdTask = randomUUID();
    const first = await proxy(firstTask);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const second = await proxy(secondTask);
    const settingsOff = await call(`/agents/${agentId}/optimization-settings`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ semanticCacheEnabled: false }),
    });
    const third = await proxy(thirdTask);
    const usage = await db
      .select({ taskId: usageEvents.taskId, cacheHit: usageEvents.cacheHit })
      .from(usageEvents)
      .where(eq(usageEvents.agentId, agentId));
    const [notification] = await db
      .insert(notifications)
      .values({
        userId,
        orgId,
        eventType: 'budget_alert_triggered',
        channel: 'in_app',
        message: 'Budget alert test',
        severity: 'P3',
        priority: 'info',
        read: false,
      })
      .returning();
    const notificationRead = await call(`/notifications/${notification.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ read: true }),
    });
    const passwordChange = await call('/auth/change-password', {
      method: 'POST',
      headers,
      body: JSON.stringify({ currentPassword: oldPassword, newPassword }),
    });
    const oldLogin = await call('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: oldPassword }),
    });
    const newLogin = await call('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: newPassword }),
    });
    const secondUsage = usage.find((row) => row.taskId === secondTask);
    const thirdUsage = usage.find((row) => row.taskId === thirdTask);
    if (
      profile.status !== 200 ||
      settingsOn.status !== 200 ||
      first.status !== 200 ||
      second.status !== 200 ||
      settingsOff.status !== 200 ||
      third.status !== 200 ||
      secondUsage?.cacheHit !== true ||
      thirdUsage?.cacheHit !== false ||
      notificationRead.status !== 200 ||
      passwordChange.status !== 200 ||
      oldLogin.status !== 401 ||
      newLogin.status !== 200
    )
      throw new Error('One or more final UI-gap checks failed');
    console.log(
      JSON.stringify(
        {
          profile: { status: profile.status, orgName: profile.body.orgName },
          settingsOn: settingsOn.status,
          proxy: {
            first: first.status,
            second: second.status,
            secondCacheHit: secondUsage.cacheHit,
            third: third.status,
            thirdCacheHitAfterDisable: thirdUsage.cacheHit,
          },
          settingsOff: settingsOff.status,
          notificationRead: notificationRead.status,
          password: {
            change: passwordChange.status,
            oldLogin: oldLogin.status,
            newLogin: newLogin.status,
          },
          keyAdd: keyAdd.status,
        },
        null,
        2
      )
    );
  } finally {
    if (agentId) await db.delete(agents).where(eq(agents.id, agentId));
    if (orgId) await db.delete(orgProviderKeys).where(eq(orgProviderKeys.orgId, orgId));
    if (orgId) await db.delete(notifications).where(eq(notifications.orgId, orgId));
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

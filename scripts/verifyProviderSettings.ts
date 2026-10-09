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
import { orgProviderKeys } from '../src/features/provider-keys/provider-keys.schema.db';
import { pricingTable } from '../src/features/pricing/pricing.schema.db';
import { usageEvents } from '../src/features/proxy/proxy.schema.db';
import { hashAgentKey } from '../src/utils/agentKey';

const baseUrl = 'http://127.0.0.1:3000';

async function json(path: string, init: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { status: response.status, body: await response.json() };
}

async function main() {
  const suffix = randomUUID();
  const rawAgentKey = `agt_pricing_${randomUUID().replaceAll('-', '')}`;
  let orgId: string | undefined;
  let userId: string | undefined;
  let teamId: string | undefined;
  let agentId: string | undefined;
  try {
    const [org] = await db
      .insert(orgs)
      .values({ name: `Provider settings ${suffix}`, timezone: 'UTC' })
      .returning();
    orgId = org.id;
    const [user] = await db
      .insert(users)
      .values({
        orgId,
        email: `provider-settings-${suffix}@example.test`,
        passwordHash: 'not-used',
        role: 'org_admin',
      })
      .returning();
    userId = user.id;
    const [team] = await db
      .insert(teams)
      .values({ orgId, name: 'Settings test team', teamLeadId: userId })
      .returning();
    teamId = team.id;
    const [agent] = await db
      .insert(agents)
      .values({
        orgId,
        teamId,
        ownerUserId: userId,
        name: 'Settings test agent',
        apiKey: hashAgentKey(rawAgentKey),
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
    const geminiKey = env.GEMINI_API_KEY!;
    const keyAdd = await json(`/orgs/${orgId}/provider-keys`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ provider: 'gemini', apiKey: geminiKey }),
    });
    const priceCreate = await json(`/orgs/${orgId}/pricing`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        provider: 'gemini',
        model: 'gemini-3.6-flash',
        inputPricePer1k: 0.001,
        outputPricePer1k: 0.002,
        effectiveDate: new Date().toISOString(),
      }),
    });
    const priceList = await json(`/orgs/${orgId}/pricing`, { method: 'GET', headers });
    // Deliberately high temporary values make the four-decimal stored usage cost observable.
    const priceEdit = await json(`/orgs/${orgId}/pricing/${priceCreate.body.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        inputPricePer1k: 10,
        outputPricePer1k: 20,
        effectiveDate: new Date().toISOString(),
      }),
    });
    const taskId = randomUUID();
    const proxy = await json('/proxy/gemini/v1beta/models/gemini-3.6-flash:generateContent', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-agent-key': rawAgentKey,
        'x-task-id': taskId,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Reply with only: priced.' }] }],
      }),
    });
    const [usage] = await db
      .select({
        inputTokens: usageEvents.inputTokens,
        outputTokens: usageEvents.outputTokens,
        costUsd: usageEvents.costUsd,
      })
      .from(usageEvents)
      .where(and(eq(usageEvents.agentId, agentId), eq(usageEvents.taskId, taskId)));
    const expectedCost = Number(
      ((usage.inputTokens * 10 + usage.outputTokens * 20) / 1000).toFixed(4)
    );
    if (proxy.status !== 200 || Number(usage.costUsd) !== expectedCost || expectedCost === 0) {
      throw new Error(
        `Configured pricing was not applied: expected ${expectedCost}, got ${usage.costUsd}`
      );
    }
    console.log(
      JSON.stringify(
        {
          keyAdd: keyAdd.status,
          keyMasked: keyAdd.body.keyLastFour,
          pricingCreate: priceCreate.status,
          pricingList: { status: priceList.status, count: priceList.body.length },
          pricingEdit: priceEdit.status,
          proxy: proxy.status,
          usage,
          expectedCost,
        },
        null,
        2
      )
    );
  } finally {
    if (agentId) await db.delete(agents).where(eq(agents.id, agentId));
    if (orgId) await db.delete(orgProviderKeys).where(eq(orgProviderKeys.orgId, orgId));
    if (orgId) await db.delete(pricingTable).where(eq(pricingTable.orgId, orgId));
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

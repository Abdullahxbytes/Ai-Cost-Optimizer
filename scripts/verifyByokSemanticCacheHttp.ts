import 'dotenv/config';
import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { db, client } from '../src/config/database';
import { orgs } from '../src/features/orgs/orgs.schema.db';
import { users } from '../src/features/user/user.schema.db';
import { teams } from '../src/features/teams/teams.schema.db';
import { agents } from '../src/features/agents/agents.schema.db';
import { optimizationRules, semanticCache } from '../src/features/optimization/optimization.schema.db';
import { usageEvents } from '../src/features/proxy/proxy.schema.db';
import { orgProviderKeys } from '../src/features/provider-keys/provider-keys.schema.db';
import { providerKeysService } from '../src/features/provider-keys/provider-keys.service';
import { hashAgentKey } from '../src/utils/agentKey';

const apiBaseUrl = process.env.TEST_API_URL ?? 'http://127.0.0.1:3000';

async function requestProxy(agentKey: string, taskId: string, prompt: string) {
  const response = await fetch(`${apiBaseUrl}/proxy/gemini/v1beta/models/gemini-3.6-flash:generateContent`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-agent-key': agentKey,
      'x-task-id': taskId,
    },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
  });
  return { status: response.status, body: await response.json() };
}

async function main() {
  const suffix = randomUUID();
  const rawAgentKey = `agt_cache_http_${randomUUID().replaceAll('-', '')}`;
  const firstTaskId = randomUUID();
  const secondTaskId = randomUUID();
  let orgId: string | undefined;
  let userId: string | undefined;
  let teamId: string | undefined;
  let agentId: string | undefined;

  try {
    const [org] = await db.insert(orgs).values({ name: `BYOK HTTP cache ${suffix}`, timezone: 'UTC' }).returning();
    orgId = org.id;
    const [user] = await db.insert(users).values({
      orgId,
      email: `byok-cache-${suffix}@example.test`,
      passwordHash: 'test-only-not-used',
      role: 'org_admin',
    }).returning();
    userId = user.id;
    const [team] = await db.insert(teams).values({ orgId, name: 'Cache regression team', teamLeadId: userId }).returning();
    teamId = team.id;
    const [agent] = await db.insert(agents).values({
      orgId,
      teamId,
      ownerUserId: userId,
      name: 'Cache regression agent',
      apiKey: hashAgentKey(rawAgentKey),
      status: 'active',
      approvedAt: new Date(),
      approvedBy: userId,
    }).returning();
    agentId = agent.id;

    await db.insert(optimizationRules).values({
      orgId,
      agentId,
      semanticCacheEnabled: true,
      promptOptimizationEnabled: false,
      cacheSimilarityThreshold: '0.92',
      cacheTtlSeconds: 3600,
    });

    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) throw new Error('GEMINI_API_KEY is required for this regression test');
    await providerKeysService.save(orgId, userId, 'gemini', geminiKey);

    const health = await fetch(`${apiBaseUrl}/health`);
    if (!health.ok) throw new Error(`Backend is not healthy at ${apiBaseUrl}: ${health.status}`);

    const prompt = 'Reply with exactly the word cacheable.';
    const first = await requestProxy(rawAgentKey, firstTaskId, prompt);
    if (first.status !== 200) throw new Error(`First proxy request failed: ${first.status} ${JSON.stringify(first.body)}`);

    // cacheSuccessfulResponse is intentionally fire-and-forget in the route controller.
    await new Promise((resolve) => setTimeout(resolve, 2500));

    const second = await requestProxy(rawAgentKey, secondTaskId, prompt);
    if (second.status !== 200) throw new Error(`Second proxy request failed: ${second.status} ${JSON.stringify(second.body)}`);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const [secondUsage] = await db.select({ cacheHit: usageEvents.cacheHit, costUsd: usageEvents.costUsd })
      .from(usageEvents)
      .where(and(eq(usageEvents.agentId, agentId), eq(usageEvents.taskId, secondTaskId)));
    const [entry] = await db.select({ hitCount: semanticCache.hitCount })
      .from(semanticCache)
      .where(eq(semanticCache.agentId, agentId));

    console.log(JSON.stringify({
      first: { status: first.status, cacheHit: false },
      second: { status: second.status, cacheHit: secondUsage?.cacheHit ?? null, costUsd: secondUsage?.costUsd ?? null },
      cacheEntryHitCount: entry?.hitCount ?? null,
      passed: secondUsage?.cacheHit === true && Number(secondUsage.costUsd) === 0,
    }, null, 2));
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

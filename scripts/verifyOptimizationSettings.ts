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
import { hashAgentKey } from '../src/utils/agentKey';
const baseUrl = 'http://127.0.0.1:3000';
async function main() {
  let orgId: string | undefined;
  let userId: string | undefined;
  let teamId: string | undefined;
  let agentId: string | undefined;
  try {
    const [org] = await db
      .insert(orgs)
      .values({ name: `Settings persistence ${randomUUID()}`, timezone: 'UTC' })
      .returning();
    orgId = org.id;
    const [user] = await db
      .insert(users)
      .values({
        orgId,
        email: `settings-${randomUUID()}@example.test`,
        passwordHash: 'unused',
        role: 'org_admin',
      })
      .returning();
    userId = user.id;
    const [team] = await db
      .insert(teams)
      .values({ orgId, name: 'Settings team', teamLeadId: userId })
      .returning();
    teamId = team.id;
    const [agent] = await db
      .insert(agents)
      .values({
        orgId,
        teamId,
        ownerUserId: userId,
        name: 'Settings agent',
        apiKey: hashAgentKey(`agt_${randomUUID()}`),
        status: 'active',
      })
      .returning();
    agentId = agent.id;
    const token = jwt.sign(
      { user_id: userId, org_id: orgId, role: 'org_admin', token_version: 0 },
      env.JWT_SECRET,
      { expiresIn: '5m' }
    );
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const patch = await fetch(`${baseUrl}/agents/${agentId}/optimization-settings`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        promptOptimizationEnabled: true,
        semanticCacheEnabled: false,
        cacheSimilarityThreshold: 0.97,
        cacheTtlSeconds: 7200,
      }),
    });
    const get = await fetch(`${baseUrl}/agents/${agentId}/optimization-settings`, { headers });
    const body = await get.json();
    if (
      patch.status !== 200 ||
      get.status !== 200 ||
      body.promptOptimizationEnabled !== true ||
      body.semanticCacheEnabled !== false ||
      body.cacheSimilarityThreshold !== 0.97 ||
      body.cacheTtlSeconds !== 7200
    )
      throw new Error('Settings persistence failed');
    console.log(JSON.stringify({ patch: patch.status, get: get.status, settings: body }, null, 2));
  } finally {
    if (agentId) await db.delete(agents).where(eq(agents.id, agentId));
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

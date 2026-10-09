import 'dotenv/config';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { buildApp } from '../src/app';
import { db, client } from '../src/config/database';
import { env } from '../src/config/env';
import { orgs } from '../src/features/orgs/orgs.schema.db';
import { users } from '../src/features/user/user.schema.db';
import { teams } from '../src/features/teams/teams.schema.db';
import { agents, agentDeletions } from '../src/features/agents/agents.schema.db';
import { hashAgentKey } from '../src/utils/agentKey';

async function main() {
  let orgId: string | undefined;
  let userId: string | undefined;
  let teamId: string | undefined;
  let agentId: string | undefined;
  const app = await buildApp();
  let captured: unknown;
  app.addHook('onError', (_request, _reply, error, done) => {
    captured = error;
    done();
  });
  try {
    const [org] = await db
      .insert(orgs)
      .values({ name: `Deletion http diagnosis ${randomUUID()}`, timezone: 'UTC' })
      .returning();
    orgId = org.id;
    const [user] = await db
      .insert(users)
      .values({
        orgId,
        email: `deletion-http-${randomUUID()}@example.test`,
        passwordHash: 'unused',
        role: 'org_admin',
      })
      .returning();
    userId = user.id;
    const [team] = await db
      .insert(teams)
      .values({ orgId, name: 'Diagnosis team', teamLeadId: userId })
      .returning();
    teamId = team.id;
    const [agent] = await db
      .insert(agents)
      .values({
        orgId,
        teamId,
        ownerUserId: userId,
        name: 'Diagnosis agent',
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
    const response = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/request-deletion`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    });
    console.log(
      response.statusCode,
      response.body,
      captured instanceof Error ? captured.stack : captured
    );
  } finally {
    if (orgId) await db.delete(agentDeletions).where(eq(agentDeletions.orgId, orgId));
    if (agentId) await db.delete(agents).where(eq(agents.id, agentId));
    if (teamId) await db.delete(teams).where(eq(teams.id, teamId));
    if (userId) await db.delete(users).where(eq(users.id, userId));
    if (orgId) await db.delete(orgs).where(eq(orgs.id, orgId));
    await app.close();
    await client.end();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

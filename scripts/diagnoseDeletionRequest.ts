import 'dotenv/config';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { db, client } from '../src/config/database';
import { orgs } from '../src/features/orgs/orgs.schema.db';
import { users } from '../src/features/user/user.schema.db';
import { teams } from '../src/features/teams/teams.schema.db';
import { agents } from '../src/features/agents/agents.schema.db';
import { agentDeletions } from '../src/features/agents/agents.schema.db';
import { agentsService } from '../src/features/agents/agents.service';
import { hashAgentKey } from '../src/utils/agentKey';

async function main() {
  let orgId: string | undefined; let userId: string | undefined; let teamId: string | undefined; let agentId: string | undefined;
  try {
    const [org] = await db.insert(orgs).values({ name: `Deletion diagnosis ${randomUUID()}`, timezone: 'UTC' }).returning(); orgId = org.id;
    const [user] = await db.insert(users).values({ orgId, email: `deletion-diagnosis-${randomUUID()}@example.test`, passwordHash: 'unused', role: 'org_admin' }).returning(); userId = user.id;
    const [team] = await db.insert(teams).values({ orgId, name: 'Diagnosis team', teamLeadId: userId }).returning(); teamId = team.id;
    const [agent] = await db.insert(agents).values({ orgId, teamId, ownerUserId: userId, name: 'Diagnosis agent', apiKey: hashAgentKey(`agt_${randomUUID()}`), status: 'active' }).returning(); agentId = agent.id;
    console.log(await agentsService.requestDeletion(agentId, { id: userId, orgId, role: 'org_admin' }));
  } finally {
    if (orgId) await db.delete(agentDeletions).where(eq(agentDeletions.orgId, orgId));
    if (agentId) await db.delete(agents).where(eq(agents.id, agentId));
    if (teamId) await db.delete(teams).where(eq(teams.id, teamId));
    if (userId) await db.delete(users).where(eq(users.id, userId));
    if (orgId) await db.delete(orgs).where(eq(orgs.id, orgId));
    await client.end();
  }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });

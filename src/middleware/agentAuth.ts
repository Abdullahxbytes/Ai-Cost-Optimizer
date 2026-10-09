import { FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../config/database';
import { agents, orgs, teams } from '../db/schema';
import { AuthError, ForbiddenError } from '../utils/errors';
import { hashAgentKey } from '../utils/agentKey';
import { assertFailureLimit, privateRateLimitIdentity, recordFailure } from '../utils/rateLimit';

export type AgentStatus = 'pending_approval' | 'active' | 'paused' | 'pending_deletion';
export type AuthenticatedAgent = {
  id: string;
  orgId: string;
  teamId: string | null;
  ownerId: string;
  status: AgentStatus;
};

declare module 'fastify' {
  interface FastifyRequest {
    agent: AuthenticatedAgent;
  }
}

export async function agentAuth(request: FastifyRequest) {
  const ipKey = `agent-auth-ip:${privateRateLimitIdentity(request.ip)}`;
  await assertFailureLimit({
    key: ipKey,
    limit: 30,
    scope: 'ip',
    message: 'Agent authentication attempts exceeded',
  });
  const key = request.headers['x-agent-key'];
  const rejectKey = async (): Promise<never> => {
    await recordFailure({
      key: ipKey,
      limit: 30,
      ttlSeconds: 60,
      scope: 'ip',
      message: 'Agent authentication attempts exceeded',
    });
    throw new AuthError('Invalid agent key');
  };
  if (!key || Array.isArray(key)) return rejectKey();
  const [agent] = await db
    .select({
      id: agents.id,
      orgId: agents.orgId,
      teamId: agents.teamId,
      ownerId: agents.ownerUserId,
      status: agents.status,
      orgStatus: orgs.status,
      teamStatus: teams.status,
    })
    .from(agents)
    .innerJoin(orgs, eq(agents.orgId, orgs.id))
    .leftJoin(teams, eq(agents.teamId, teams.id))
    .where(eq(agents.apiKey, hashAgentKey(key)))
    .limit(1);
  if (!agent) return rejectKey();
  if (agent.orgStatus !== 'active') throw new ForbiddenError('Organization is blocked');
  if (agent.teamStatus === 'archived') throw new ForbiddenError('Team is archived');
  if (agent.status !== 'active') throw new ForbiddenError('Agent is not active');
  request.agent = agent;
}

import { FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../config/database';
import { agents } from '../db/schema';
import { AuthError, ForbiddenError } from '../utils/errors';

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
  const key = request.headers['x-agent-key'];
  if (!key || Array.isArray(key)) throw new AuthError('Invalid agent key');
  const [agent] = await db
    .select({
      id: agents.id,
      orgId: agents.orgId,
      teamId: agents.teamId,
      ownerId: agents.ownerUserId,
      status: agents.status,
    })
    .from(agents)
    .where(eq(agents.apiKey, key))
    .limit(1);
  if (!agent) throw new AuthError('Invalid agent key');
  if (agent.status === 'pending_approval') throw new ForbiddenError('Agent pending approval');
  if (agent.status === 'paused') throw new ForbiddenError('Agent paused');
  request.agent = agent;
}

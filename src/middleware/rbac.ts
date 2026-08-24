import { FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../config/database';
import { agents, teams } from '../db/schema';
import { AuthenticatedUser, Role } from './auth';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/errors';

export function requireRole(allowedRoles: Role[]) {
  return async (request: FastifyRequest) => {
    if (!allowedRoles.includes(request.user.role))
      throw new ForbiddenError('Insufficient permissions');
  };
}

export function requireOrgScope() {
  return async (request: FastifyRequest) => {
    const params = request.params as { teamId?: string; agentId?: string };
    const resource = params.teamId
      ? (
          await db
            .select({ orgId: teams.orgId })
            .from(teams)
            .where(eq(teams.id, params.teamId))
            .limit(1)
        )[0]
      : params.agentId
        ? (
            await db
              .select({ orgId: agents.orgId })
              .from(agents)
              .where(eq(agents.id, params.agentId))
              .limit(1)
          )[0]
        : undefined;
    if (!resource) {
      if (!params.teamId && !params.agentId)
        throw new ValidationError('No scoped resource route parameter provided');
      throw new NotFoundError('Resource not found');
    }
    if (request.user.orgId !== resource.orgId)
      throw new ForbiddenError('Organization access denied');
  };
}

export async function canAccessTeam(user: AuthenticatedUser, teamId: string): Promise<boolean> {
  const [team] = await db
    .select({ orgId: teams.orgId, teamLeadId: teams.teamLeadId })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  if (!team || user.orgId !== team.orgId) return false;
  return user.role === 'org_admin' || (user.role === 'team_lead' && team.teamLeadId === user.id);
}

export async function canAccessAgent(user: AuthenticatedUser, agentId: string): Promise<boolean> {
  const [agent] = await db
    .select({ orgId: agents.orgId, teamId: agents.teamId, ownerUserId: agents.ownerUserId })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  if (!agent || user.orgId !== agent.orgId) return false;
  if (user.role === 'org_admin') return true;
  if (user.role === 'developer' && agent.ownerUserId === user.id) return true;
  return user.role === 'team_lead' && agent.teamId !== null && canAccessTeam(user, agent.teamId);
}

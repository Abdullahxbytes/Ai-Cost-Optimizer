import { FastifyPluginAsync } from 'fastify'
import { eq } from 'drizzle-orm'
import { db } from '../config/database'
import { authenticate } from '../middleware/auth'
import { canAccessTeam, requireOrgScope, requireRole } from '../middleware/rbac'
import { teams } from '../schemas'
import { ForbiddenError, NotFoundError } from '../utils/errors'

export const teamsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:teamId', { preHandler: [authenticate, requireRole(['org_admin', 'team_lead']), requireOrgScope()] }, async (request) => {
    const { teamId } = request.params as { teamId: string }
    if (request.user.role === 'team_lead' && !await canAccessTeam(request.user, teamId)) throw new ForbiddenError('Team access denied')
    const [team] = await db.select({ id: teams.id, orgId: teams.orgId, name: teams.name, parentTeamId: teams.parentTeamId, teamLeadId: teams.teamLeadId })
      .from(teams).where(eq(teams.id, teamId)).limit(1)
    if (!team) throw new NotFoundError('Team not found')
    return team
  })
}

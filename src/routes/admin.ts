import { FastifyPluginAsync } from 'fastify'
import { db } from '../config/database'
import { authenticate } from '../middleware/auth'
import { requireRole } from '../middleware/rbac'
import { orgs } from '../schemas'

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.get('/orgs', { preHandler: [authenticate, requireRole(['super_admin'])] }, async () => {
    return db.select({ id: orgs.id, name: orgs.name, status: orgs.status }).from(orgs)
  })
}

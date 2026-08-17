import { FastifyPluginAsync } from 'fastify'
import { agentAuth } from '../middleware/agentAuth'

/** Temporary Day 2 auth proof route; remove once proxy routes are implemented. */
export const agentTestRoutes: FastifyPluginAsync = async (app) => {
  app.get('/ping', { preHandler: [agentAuth] }, async (request) => ({
    agentId: request.agent.id, orgId: request.agent.orgId, status: request.agent.status,
  }))
}

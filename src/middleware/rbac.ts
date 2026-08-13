import { FastifyRequest } from 'fastify'
import { ForbiddenError } from '../utils/errors'

export function requireRole(...roles: string[]) {
  return async (request: FastifyRequest) => {
    const user = request.user as { roles?: string[] }
    if (!user.roles?.some((role) => roles.includes(role))) throw new ForbiddenError('Insufficient permissions')
  }
}

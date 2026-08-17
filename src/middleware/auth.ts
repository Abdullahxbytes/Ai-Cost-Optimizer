import { FastifyRequest } from 'fastify'
import jwt from 'jsonwebtoken'
import { env } from '../config/env'
import { AuthError } from '../utils/errors'

export type Role = 'super_admin' | 'org_admin' | 'team_lead' | 'developer' | 'finance' | 'auditor'
export type AuthenticatedUser = { id: string; orgId: string | null; role: Role }

declare module 'fastify' {
  interface FastifyRequest { user: AuthenticatedUser }
}

export async function authenticate(request: FastifyRequest) {
  const token = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) throw new AuthError('Invalid or expired session token')
  try {
    const payload = jwt.verify(token, env.JWT_SECRET)
    if (typeof payload === 'string' || payload.purpose === '2fa_pending' || typeof payload.user_id !== 'string' ||
      (typeof payload.org_id !== 'string' && payload.org_id !== null) ||
      !['super_admin', 'org_admin', 'team_lead', 'developer', 'finance', 'auditor'].includes(payload.role as string)) {
      throw new AuthError('Invalid or expired session token')
    }
    request.user = { id: payload.user_id, orgId: payload.org_id, role: payload.role as Role }
  } catch (error) {
    if (error instanceof AuthError) throw error
    throw new AuthError('Invalid or expired session token')
  }
}

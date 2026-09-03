import { FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AppError, AuthError, ForbiddenError } from '../utils/errors';
import { userRepository } from '../features/user/user.repository';

export type Role = 'super_admin' | 'org_admin' | 'team_lead' | 'developer' | 'finance' | 'auditor';
export type AuthenticatedUser = { id: string; orgId: string | null; role: Role };

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthenticatedUser;
  }
}

export async function authenticate(request: FastifyRequest) {
  const token = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new AuthError('Invalid or expired session token');
  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    if (
      typeof payload === 'string' ||
      payload.purpose === '2fa_pending' ||
      typeof payload.user_id !== 'string' ||
      (typeof payload.org_id !== 'string' && payload.org_id !== null) ||
      typeof payload.token_version !== 'number' ||
      !['super_admin', 'org_admin', 'team_lead', 'developer', 'finance', 'auditor'].includes(
        payload.role as string
      )
    ) {
      throw new AuthError('Invalid or expired session token');
    }
    if (payload.org_id !== null) {
      const current = await userRepository.findActiveTenantPrincipal(payload.user_id, payload.org_id);
      if (!current) throw new AuthError('Invalid or expired session token');
      if (current.orgStatus !== 'active') throw new ForbiddenError('Organization is blocked');
      if (current.tokenVersion !== payload.token_version)
        throw new AuthError('Invalid or expired session token');
      request.user = { id: current.id, orgId: payload.org_id, role: current.role as Role };
      return;
    }
    const current = await userRepository.findCurrentSuperAdmin(payload.user_id);
    if (!current || current.tokenVersion !== payload.token_version)
      throw new AuthError('Invalid or expired session token');
    request.user = { id: payload.user_id, orgId: null, role: payload.role as Role };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AuthError('Invalid or expired session token');
  }
}

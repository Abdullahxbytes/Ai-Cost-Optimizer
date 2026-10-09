import jwt, { JwtPayload } from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../../../config/env';
import { AuthenticatedAgent } from '../../../middleware/agentAuth';
import { ValidationError } from '../../../utils/errors';

const subjectSchema = z
  .object({
    subject: z.string().min(1).max(256),
    authorizationVersion: z.string().min(1).max(256),
  })
  .strict();
const ISSUER = 'costflow-cache-context';

export function issueCacheUserContext(input: {
  orgId: string;
  agentId: string;
  subject: string;
  authorizationVersion: string;
}): string {
  const parsed = subjectSchema.safeParse({
    subject: input.subject,
    authorizationVersion: input.authorizationVersion,
  });
  if (!parsed.success || !env.CACHE_CONTEXT_SIGNING_SECRET) {
    throw new ValidationError('Cache user context cannot be issued');
  }
  return jwt.sign(
    {
      orgId: input.orgId,
      agentId: input.agentId,
      subject: input.subject,
      authorizationVersion: input.authorizationVersion,
    },
    env.CACHE_CONTEXT_SIGNING_SECRET,
    { algorithm: 'HS256', issuer: ISSUER, audience: input.agentId, expiresIn: '5m' }
  );
}

export function verifyCacheUserContext(token: unknown, agent: AuthenticatedAgent) {
  if (typeof token !== 'string' || !env.CACHE_CONTEXT_SIGNING_SECRET) return null;
  try {
    const payload = jwt.verify(token, env.CACHE_CONTEXT_SIGNING_SECRET, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: agent.id,
    }) as JwtPayload;
    if (payload.orgId !== agent.orgId || payload.agentId !== agent.id) return null;
    const parsed = subjectSchema.safeParse({
      subject: payload.subject,
      authorizationVersion: payload.authorizationVersion,
    });
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

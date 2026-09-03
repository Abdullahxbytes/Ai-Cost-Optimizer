import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { redis } from '../../config/redis';
import { authenticate } from '../../middleware/auth';
import { requireOrgScope, requireRole } from '../../middleware/rbac';
import { RateLimitError, ValidationError } from '../../utils/errors';
import { providerKeysService } from './provider-keys.service';
const provider = z.enum(['openai', 'anthropic', 'gemini']);
export const providerKeysRoutes: FastifyPluginAsync = async (app) => { const guard = [authenticate, requireRole(['org_admin']), requireOrgScope()]; app.get('/orgs/:orgId/provider-keys', { preHandler: guard }, (r) => providerKeysService.list((r.params as { orgId: string }).orgId)); app.post('/orgs/:orgId/provider-keys', { preHandler: guard }, async (r) => { const orgId = (r.params as { orgId: string }).orgId; const key = `ratelimit:provider-key:${orgId}:${Math.floor(Date.now() / 3_600_000)}`; const count = await redis.incr(key); if (count === 1) await redis.expire(key, 3600); if (count > 10) throw new RateLimitError(Math.max(await redis.ttl(key), 1)); const body = z.object({ provider, apiKey: z.string().min(1) }).safeParse(r.body); if (!body.success) throw new ValidationError('Invalid provider key'); return providerKeysService.save(orgId, r.user.id, body.data.provider, body.data.apiKey); }); app.delete('/orgs/:orgId/provider-keys/:provider', { preHandler: guard }, (r) => { const value = provider.safeParse((r.params as { provider: string }).provider); if (!value.success) throw new ValidationError('Invalid provider'); return providerKeysService.remove((r.params as { orgId: string }).orgId, r.user.id, value.data); }); };

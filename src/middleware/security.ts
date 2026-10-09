import { FastifyRequest } from 'fastify';
import { redis } from '../config/redis';
import { RateLimitError, ValidationError } from '../utils/errors';
import { z } from '../utils/validators';

const uuid = z.string().uuid();
const ANALYTICS_LIMIT = 120;
const ANALYTICS_WINDOW_SECONDS = 60;

/** Validates every conventional `*Id` route parameter in one place. */
export async function validateUuidRouteParams(request: FastifyRequest): Promise<void> {
  if (!request.params || typeof request.params !== 'object') return;
  for (const [name, value] of Object.entries(request.params as Record<string, unknown>)) {
    if (!name.endsWith('Id')) continue;
    if (typeof value !== 'string' || !uuid.safeParse(value).success) {
      throw new ValidationError(`Invalid ${name}`);
    }
  }
}

/** Per-user protection for database-heavy analytics endpoints. */
export async function analyticsRateLimit(request: FastifyRequest): Promise<void> {
  const window = Math.floor(Date.now() / (ANALYTICS_WINDOW_SECONDS * 1000));
  const key = `ratelimit:analytics:${request.user.id}:${window}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, ANALYTICS_WINDOW_SECONDS + 1);
  if (count > ANALYTICS_LIMIT) {
    throw new RateLimitError(Math.max(await redis.ttl(key), 1));
  }
}

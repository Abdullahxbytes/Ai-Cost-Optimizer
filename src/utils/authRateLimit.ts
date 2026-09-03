import { redis } from '../config/redis';
import { RateLimitError } from './errors';

export async function enforceAuthRateLimit(key: string, limit: number, ttlSeconds: number): Promise<void> {
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, ttlSeconds);
  if (count > limit) throw new RateLimitError(Math.max(1, await redis.ttl(key)));
}

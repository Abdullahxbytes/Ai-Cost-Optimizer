import { createHash } from 'crypto';
import { redis } from '../config/redis';
import { RateLimitError } from './errors';

export type RateLimitScope = RateLimitError['scope'];

function windowDetails(windowSeconds: number, now = Date.now()) {
  const windowMs = windowSeconds * 1000;
  return {
    suffix: Math.floor(now / windowMs),
    retryAfter: Math.max(1, Math.ceil((windowMs - (now % windowMs)) / 1000)),
  };
}

export function privateRateLimitIdentity(value: string): string {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

export async function consumeRateLimit(input: {
  key: string;
  limit: number;
  windowSeconds: number;
  scope: RateLimitScope;
  message?: string;
}): Promise<void> {
  const window = windowDetails(input.windowSeconds);
  const key = `ratelimit:${input.key}:${window.suffix}`;
  const results = await redis
    .multi()
    .incr(key)
    .expire(key, input.windowSeconds + 1)
    .exec();
  const count = Number(results?.[0]);
  if (count > input.limit) throw new RateLimitError(window.retryAfter, input.scope, input.message);
}

export async function assertFailureLimit(input: {
  key: string;
  limit: number;
  scope: 'account' | 'ip';
  message?: string;
}): Promise<void> {
  const ttl = await redis.ttl(`ratelimit:failure:${input.key}`);
  const count = Number((await redis.get(`ratelimit:failure:${input.key}`)) ?? 0);
  if (count >= input.limit) throw new RateLimitError(Math.max(1, ttl), input.scope, input.message);
}

export async function recordFailure(input: {
  key: string;
  limit: number;
  ttlSeconds: number;
  scope: 'account' | 'ip';
  message?: string;
}): Promise<void> {
  const key = `ratelimit:failure:${input.key}`;
  const results = await redis.multi().incr(key).expire(key, input.ttlSeconds).exec();
  const count = Number(results?.[0]);
  if (count > input.limit)
    throw new RateLimitError(Math.max(1, await redis.ttl(key)), input.scope, input.message);
}

export async function clearFailureLimit(key: string): Promise<void> {
  await redis.del(`ratelimit:failure:${key}`);
}

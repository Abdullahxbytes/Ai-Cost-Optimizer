import { redis } from '../../src/config/redis';
import { createTenant, tenantToken, testApp } from '../helpers/auth';
import { privateRateLimitIdentity } from '../../src/utils/rateLimit';

describe('layered dashboard rate limits', () => {
  it('limits an authenticated dashboard user without relying on their IP', async () => {
    const { user } = await createTenant();
    const app = await testApp();
    try {
      const window = Math.floor(Date.now() / 60_000);
      await redis.set(`ratelimit:dashboard-user:read:${user.id}:${window}`, '600');
      const response = await app.inject({
        method: 'GET',
        url: '/auth/me',
        remoteAddress: '10.40.0.1',
        headers: { authorization: `Bearer ${tenantToken(user)}` },
      });
      expect(response.statusCode).toBe(429);
      expect(response.json()).toMatchObject({ code: 'RATE_LIMIT', scope: 'user' });
    } finally {
      await app.close();
    }
  });

  it('enforces the organization dashboard ceiling across users', async () => {
    const { org, user } = await createTenant();
    const app = await testApp();
    try {
      const window = Math.floor(Date.now() / 60_000);
      await redis.set(`ratelimit:dashboard-org:${org.id}:${window}`, '3000');
      const response = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { authorization: `Bearer ${tenantToken(user)}` },
      });
      expect(response.statusCode).toBe(429);
      expect(response.json()).toMatchObject({ code: 'RATE_LIMIT', scope: 'organization' });
    } finally {
      await app.close();
    }
  });
});

describe('unauthenticated and global safeguards', () => {
  it('blocks repeated invalid agent-key traffic by IP before another lookup', async () => {
    const app = await testApp();
    const ip = '10.50.0.1';
    const key = `ratelimit:failure:agent-auth-ip:${privateRateLimitIdentity(ip)}`;
    try {
      await redis.set(key, '30', { EX: 60 });
      const response = await app.inject({
        method: 'POST',
        url: '/proxy/gemini/test',
        remoteAddress: ip,
        headers: { 'x-agent-key': 'invalid' },
        payload: {},
      });
      expect(response.statusCode).toBe(429);
      expect(response.json()).toMatchObject({ code: 'RATE_LIMIT', scope: 'ip' });
    } finally {
      await redis.del(key);
      await app.close();
    }
  });

  it('uses a high global circuit breaker independent of client IP', async () => {
    const app = await testApp();
    const window = Math.floor(Date.now() / 60_000);
    const key = `ratelimit:global-api:${window}`;
    try {
      await redis.set(key, '100000');
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        remoteAddress: '10.60.0.1',
        payload: { email: 'nobody@example.test', password: 'incorrect' },
      });
      expect(response.statusCode).toBe(429);
      expect(response.json()).toMatchObject({ code: 'RATE_LIMIT', scope: 'global' });
    } finally {
      await redis.del(key);
      await app.close();
    }
  });
});

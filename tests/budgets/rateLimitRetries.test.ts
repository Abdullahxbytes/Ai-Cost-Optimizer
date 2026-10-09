import axios from 'axios';
import { randomUUID } from 'crypto';
import { jest } from '@jest/globals';
import { and, eq } from 'drizzle-orm';
import { db } from '../../src/config/database';
import { redis } from '../../src/config/redis';
import { usageEvents } from '../../src/features/proxy/proxy.schema.db';
import { testApp } from '../helpers/auth';
import { geminiRequest, seedFinancialFixture, waitFor } from '../helpers/financial';

describe('proxy rate limits and provider retries', () => {
  it('returns 429 and retryAfter once the per-agent minute limit is exceeded', async () => {
    const f = await seedFinancialFixture({ agentCount: 1 });
    const app = await testApp();
    try {
      const window = Math.floor(Date.now() / 60_000);
      await redis.set(`ratelimit:agent:${f.agents[0].id}:${window}`, '60');
      const response = await app.inject(geminiRequest(f.agents[0].rawKey));
      expect(response.statusCode).toBe(429);
      expect(response.json()).toMatchObject({
        retryAfter: expect.any(Number),
        scope: 'agent',
        code: 'RATE_LIMIT',
      });
      expect(response.headers['retry-after']).toBeDefined();
    } finally {
      await app.close();
    }
  });
  it('enforces an organization-wide proxy limit independently of agent limits', async () => {
    const f = await seedFinancialFixture({ agentCount: 1 });
    const app = await testApp();
    try {
      const window = Math.floor(Date.now() / 60_000);
      await redis.set(`ratelimit:proxy-org:${f.org.id}:${window}`, '3000');
      const response = await app.inject(geminiRequest(f.agents[0].rawKey));
      expect(response.statusCode).toBe(429);
      expect(response.json()).toMatchObject({ scope: 'organization', code: 'RATE_LIMIT' });
    } finally {
      await app.close();
    }
  });
  it('does not retry a mocked provider 4xx response', async () => {
    const f = await seedFinancialFixture({ agentCount: 1 });
    const app = await testApp();
    const spy = jest
      .spyOn(axios, 'post')
      .mockResolvedValue({ status: 401, data: {}, headers: {} } as never);
    try {
      expect((await app.inject(geminiRequest(f.agents[0].rawKey))).statusCode).toBe(502);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
      await app.close();
    }
  });
  it('retries mocked 5xx and timeout failures exactly three times', async () => {
    const f = await seedFinancialFixture({ agentCount: 1 });
    const app = await testApp();
    const spy = jest.spyOn(axios, 'post');
    try {
      spy.mockResolvedValue({ status: 500, data: {}, headers: {} } as never);
      expect((await app.inject(geminiRequest(f.agents[0].rawKey))).statusCode).toBe(502);
      expect(spy).toHaveBeenCalledTimes(3);
      spy.mockReset();
      spy.mockRejectedValue({ code: 'ECONNABORTED' } as never);
      expect((await app.inject(geminiRequest(f.agents[0].rawKey))).statusCode).toBe(502);
      expect(spy).toHaveBeenCalledTimes(3);
    } finally {
      spy.mockRestore();
      await app.close();
    }
  });
  it('records zero-cost error and timeout usage after retries are exhausted', async () => {
    const f = await seedFinancialFixture({ agentCount: 1 });
    const app = await testApp();
    const spy = jest.spyOn(axios, 'post');
    const errorTask = randomUUID();
    const timeoutTask = randomUUID();
    try {
      spy.mockResolvedValue({ status: 500, data: {}, headers: {} } as never);
      await app.inject(geminiRequest(f.agents[0].rawKey, errorTask));
      const error = await waitFor(
        async () =>
          (
            await db
              .select()
              .from(usageEvents)
              .where(and(eq(usageEvents.taskId, errorTask), eq(usageEvents.status, 'error')))
          )[0]
      );
      expect(error.costUsd).toBe('0.0000');
      spy.mockReset();
      spy.mockRejectedValue({ code: 'ECONNABORTED' } as never);
      await app.inject(geminiRequest(f.agents[0].rawKey, timeoutTask));
      const timeout = await waitFor(
        async () =>
          (
            await db
              .select()
              .from(usageEvents)
              .where(and(eq(usageEvents.taskId, timeoutTask), eq(usageEvents.status, 'timeout')))
          )[0]
      );
      expect(timeout.costUsd).toBe('0.0000');
    } finally {
      spy.mockRestore();
      await app.close();
    }
  });
});

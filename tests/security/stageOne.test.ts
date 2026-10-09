import { randomUUID } from 'crypto';
import { redis } from '../../src/config/redis';
import { analyticsRateLimit } from '../../src/middleware/security';
import { csvCell } from '../../src/utils/validators';
import { createTenant, tenantToken, testApp } from '../helpers/auth';

describe('stage one request and export controls', () => {
  it.each([
    ['=2+3', "'=2+3"],
    [' +SUM(A1:A2)', "' +SUM(A1:A2)"],
    ['-10+20', "'-10+20"],
    ['@SUM(A1:A2)', "'@SUM(A1:A2)"],
    ['safe text', 'safe text'],
    ['value,with,commas', '"value,with,commas"'],
  ])('neutralizes spreadsheet formulas while preserving CSV quoting: %s', (value, expected) => {
    expect(csvCell(value)).toBe(expected);
  });

  it('rejects malformed UUID route parameters before controller access', async () => {
    const { user } = await createTenant();
    const app = await testApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/agents/not-a-uuid',
        headers: { authorization: `Bearer ${tenantToken(user)}` },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR', error: 'Invalid agentId' });
    } finally {
      await app.close();
    }
  });

  it('rejects analytics date ranges longer than 366 days', async () => {
    const { user } = await createTenant();
    const app = await testApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/analytics/costs/by-time?scope=org&scopeId=${user.orgId}&from=2024-01-01&to=2026-01-01`,
        headers: { authorization: `Bearer ${tenantToken(user)}` },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        code: 'VALIDATION_ERROR',
        error: 'Analytics range cannot exceed 366 days',
      });
    } finally {
      await app.close();
    }
  });

  it('rate-limits database-heavy analytics calls per authenticated user', async () => {
    const id = randomUUID();
    const request = { user: { id } } as never;
    for (let call = 0; call < 120; call += 1) await analyticsRateLimit(request);
    await expect(analyticsRateLimit(request)).rejects.toMatchObject({ statusCode: 429 });
    expect(await redis.keys(`ratelimit:analytics:${id}:*`)).toHaveLength(1);
  });
});

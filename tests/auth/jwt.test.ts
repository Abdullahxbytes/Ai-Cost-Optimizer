import jwt from 'jsonwebtoken';
import { createTenant, tenantToken, testApp } from '../helpers/auth';

describe('JWT validation', () => {
  it('accepts a valid unexpired token', async () => {
    const { user } = await createTenant();
    const app = await testApp();
    try {
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/notifications',
            headers: { authorization: `Bearer ${tenantToken(user)}` },
          })
        ).statusCode
      ).toBe(200);
    } finally {
      await app.close();
    }
  });
  it('rejects an expired token', async () => {
    const { user } = await createTenant();
    const app = await testApp();
    try {
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/notifications',
            headers: { authorization: `Bearer ${tenantToken(user, -1)}` },
          })
        ).statusCode
      ).toBe(401);
    } finally {
      await app.close();
    }
  });
  it('rejects a malformed token', async () => {
    const app = await testApp();
    try {
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/notifications',
            headers: { authorization: 'Bearer not-a-jwt' },
          })
        ).statusCode
      ).toBe(401);
    } finally {
      await app.close();
    }
  });
  it('rejects a token with a tampered signature', async () => {
    const { user } = await createTenant();
    const app = await testApp();
    try {
      const token = tenantToken(user);
      const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/notifications',
            headers: { authorization: `Bearer ${tampered}` },
          })
        ).statusCode
      ).toBe(401);
    } finally {
      await app.close();
    }
  });
});

import axios from 'axios';
import { jest } from '@jest/globals';
import { eq } from 'drizzle-orm';
import { db } from '../../src/config/database';
import { users } from '../../src/features/user/user.schema.db';
import { createSuperAdmin, superAdminToken, tenantToken, testApp } from '../helpers/auth';
import { geminiRequest, geminiSuccess, seedFinancialFixture } from '../helpers/financial';

describe('organization block data effects', () => {
  it('invalidates user sessions and agent proxy access; only a fresh post-unblock login restores user access', async () => {
    const f = await seedFinancialFixture({ agentCount: 1 }); const { admin: superAdmin } = await createSuperAdmin(); const app = await testApp(); const spy = jest.spyOn(axios, 'post').mockResolvedValue(geminiSuccess() as never); const oldToken = f.adminToken;
    try {
      const superHeaders = { authorization: `Bearer ${superAdminToken(superAdmin)}` };
      expect((await app.inject({ method: 'POST', url: `/orgs/${f.org.id}/block`, headers: superHeaders })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${oldToken}` } })).statusCode).toBe(403);
      expect((await app.inject(geminiRequest(f.agents[0].rawKey))).statusCode).toBe(403);
      expect(spy).not.toHaveBeenCalled();
      expect((await app.inject({ method: 'POST', url: `/orgs/${f.org.id}/unblock`, headers: superHeaders })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${oldToken}` } })).statusCode).toBe(401);
      const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: f.admin.email, password: 'CorrectPassword9!' } }); expect(login.statusCode).toBe(200);
      // A real fresh login is permitted after unblock. The 2FA exchange itself is covered in the
      // dedicated auth suite; issue the equivalent current-version session to isolate this test.
      const [current] = await db.select({ tokenVersion: users.tokenVersion }).from(users).where(eq(users.id, f.admin.id));
      const freshToken = tenantToken({ ...f.admin, tokenVersion: current.tokenVersion });
      expect((await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${freshToken}` } })).statusCode).toBe(200);
    } finally { spy.mockRestore(); await app.close(); }
  });
});

import { eq, sql } from 'drizzle-orm';
import { db } from '../../src/config/database';
import { orgsRepository } from '../../src/features/orgs/orgs.repository';
import { superAdmins, users } from '../../src/features/user/user.schema.db';
import { createSuperAdmin, createTenant, superAdminToken, tenantToken, testApp } from '../helpers/auth';

describe('session invalidation', () => {
  it('invalidates an old token after password change', async () => {
    const { user, password } = await createTenant(); const token = tenantToken(user); const app = await testApp();
    try { expect((await app.inject({ method: 'POST', url: '/auth/change-password', headers: { authorization: `Bearer ${token}` }, payload: { currentPassword: password, newPassword: 'NewPassword9!' } })).statusCode).toBe(200); expect((await app.inject({ method: 'GET', url: '/notifications', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401); } finally { await app.close(); }
  });
  it('allows a fresh login after password change', async () => {
    const { user, password } = await createTenant(); const app = await testApp();
    try { await app.inject({ method: 'POST', url: '/auth/change-password', headers: { authorization: `Bearer ${tenantToken(user)}` }, payload: { currentPassword: password, newPassword: 'NewPassword9!' } }); const fresh = await app.inject({ method: 'POST', url: '/auth/login', remoteAddress: '10.4.0.1', payload: { email: user.email, password: 'NewPassword9!' } }); expect(fresh.statusCode).toBe(200); } finally { await app.close(); }
  });
  it('invalidates active tokens when an organization is blocked', async () => {
    const { org, user } = await createTenant(); const token = tenantToken(user); const app = await testApp();
    try { await orgsRepository.setStatus(org.id, 'blocked'); const response = await app.inject({ method: 'GET', url: '/notifications', headers: { authorization: `Bearer ${token}` } }); expect(response.statusCode).toBe(403); } finally { await app.close(); }
  });
  it('does not revive old tokens when an organization is unblocked', async () => {
    const { org, user, password } = await createTenant(); const token = tenantToken(user); const app = await testApp();
    try { await orgsRepository.setStatus(org.id, 'blocked'); await orgsRepository.setStatus(org.id, 'active'); expect((await app.inject({ method: 'GET', url: '/notifications', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401); expect((await app.inject({ method: 'POST', url: '/auth/login', remoteAddress: '10.4.0.2', payload: { email: user.email, password } })).statusCode).toBe(200); } finally { await app.close(); }
  });
  it('rejects token-version mismatches for tenant users and Super Admins', async () => {
    const tenant = await createTenant(); const superAdmin = await createSuperAdmin(); const app = await testApp();
    try { await db.update(users).set({ tokenVersion: sql`${users.tokenVersion} + 1` }).where(eq(users.id, tenant.user.id)); await db.update(superAdmins).set({ tokenVersion: sql`${superAdmins.tokenVersion} + 1` }).where(eq(superAdmins.id, superAdmin.admin.id)); expect((await app.inject({ method: 'GET', url: '/notifications', headers: { authorization: `Bearer ${tenantToken(tenant.user)}` } })).statusCode).toBe(401); expect((await app.inject({ method: 'GET', url: '/notifications', headers: { authorization: `Bearer ${superAdminToken(superAdmin.admin)}` } })).statusCode).toBe(401); } finally { await app.close(); }
  });
});

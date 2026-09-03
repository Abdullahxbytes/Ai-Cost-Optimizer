import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../src/config/database';
import { assertCanRemoveSuperAdmin, superAdminsService } from '../../src/features/super-admins/super-admins.service';
import { superAdmins, users } from '../../src/features/user/user.schema.db';
import { testApp } from '../helpers/auth';
import { seedFinancialFixture } from '../helpers/financial';

describe('last administrator guards', () => {
  it('rejects removing and demoting the last Org Admin', async () => {
    const f = await seedFinancialFixture(); const app = await testApp(); const headers = { authorization: `Bearer ${f.adminToken}` };
    try {
      expect((await app.inject({ method: 'DELETE', url: `/orgs/${f.org.id}/users/${f.admin.id}`, headers })).statusCode).toBe(400);
      expect((await app.inject({ method: 'PATCH', url: `/orgs/${f.org.id}/users/${f.admin.id}`, headers, payload: { role: 'developer' } })).statusCode).toBe(400);
    } finally { await app.close(); }
  });
  it('pure last-Super-Admin guard rejects before any database deletion', () => {
    expect(() => assertCanRemoveSuperAdmin(1)).toThrow('Cannot remove the last remaining Super Admin');
  });
  it('allows removal of a non-last Org Admin and Super Admin', async () => {
    const f = await seedFinancialFixture(); const app = await testApp();
    try {
      const [secondOrgAdmin] = await db.insert(users).values({ orgId: f.org.id, email: `second-org-admin-${randomUUID()}@example.test`, passwordHash: await bcrypt.hash('CorrectPassword9!', 12), role: 'org_admin' }).returning();
      expect((await app.inject({ method: 'DELETE', url: `/orgs/${f.org.id}/users/${secondOrgAdmin.id}`, headers: { authorization: `Bearer ${f.adminToken}` } })).statusCode).toBe(200);
      const [one, two] = await db.insert(superAdmins).values([{ email: `super-one-${randomUUID()}@example.test`, passwordHash: await bcrypt.hash('CorrectPassword9!', 12) }, { email: `super-two-${randomUUID()}@example.test`, passwordHash: await bcrypt.hash('CorrectPassword9!', 12) }]).returning();
      expect((await superAdminsService.remove(one.id)).id).toBe(one.id); expect(await db.select().from(superAdmins).where(eq(superAdmins.id, two.id))).toHaveLength(1);
    } finally { await app.close(); }
  });
});

import { eq, sql } from 'drizzle-orm';
import { db } from '../../config/database';
import { orgs } from './orgs.schema.db';
import { users } from '../user/user.schema.db';

export type OrganizationUpdate = { name?: string; timezone?: string };

export const orgsRepository = {
  list: () => db.select({ id: orgs.id, name: orgs.name, timezone: orgs.timezone, currency: orgs.currency, status: orgs.status }).from(orgs).orderBy(orgs.name),
  async findById(orgId: string) {
    const [organization] = await db
      .select({ id: orgs.id, name: orgs.name, timezone: orgs.timezone, currency: orgs.currency, status: orgs.status })
      .from(orgs)
      .where(eq(orgs.id, orgId))
      .limit(1);
    return organization ?? null;
  },

  async update(orgId: string, update: OrganizationUpdate) {
    const [organization] = await db
      .update(orgs)
      .set({ ...update, updatedAt: new Date() })
      .where(eq(orgs.id, orgId))
      .returning({ id: orgs.id, name: orgs.name, timezone: orgs.timezone, currency: orgs.currency, status: orgs.status });
    return organization ?? null;
  },
  async setStatus(orgId: string, status: 'active' | 'blocked') {
    return db.transaction(async (tx) => {
      const [organization] = await tx.update(orgs).set({ status, updatedAt: new Date() }).where(eq(orgs.id, orgId))
        .returning({ id: orgs.id, name: orgs.name, status: orgs.status });
      if (organization && status === 'blocked') {
        // Invalidates all existing tenant JWTs; unblock deliberately does not reverse this.
        await tx.update(users).set({ tokenVersion: sql`${users.tokenVersion} + 1`, updatedAt: new Date() }).where(eq(users.orgId, orgId));
      }
      return organization ?? null;
    });
  },
};

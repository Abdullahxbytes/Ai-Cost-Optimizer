import { eq } from 'drizzle-orm';
import { db } from '../../config/database';
import { orgs } from './orgs.schema.db';

export type OrganizationUpdate = { name?: string; timezone?: string };

export const orgsRepository = {
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
};

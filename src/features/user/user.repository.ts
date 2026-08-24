import { eq } from 'drizzle-orm';
import { db } from '../../config/database';
import { orgs, superAdmins, users } from '../../db/schema';
export const userRepository = {
  createOrganizationAndAdmin: (
    orgName: string,
    timezone: string,
    email: string,
    passwordHash: string
  ) =>
    db.transaction(async (tx) => {
      const [org] = await tx
        .insert(orgs)
        .values({ name: orgName, timezone, currency: 'USD', status: 'active' })
        .returning({ id: orgs.id });
      const [user] = await tx
        .insert(users)
        .values({ orgId: org.id, email, passwordHash, role: 'org_admin' })
        .returning({ id: users.id, email: users.email });
      return { orgId: org.id, userId: user.id, email: user.email };
    }),
  findUsersByEmail: (email: string) =>
    db
      .select({
        userId: users.id,
        orgId: users.orgId,
        passwordHash: users.passwordHash,
        twoFactorSecret: users.twoFactorSecret,
        orgStatus: orgs.status,
      })
      .from(users)
      .innerJoin(orgs, eq(users.orgId, orgs.id))
      .where(eq(users.email, email))
      .limit(2),
  findSuperAdminByEmail: (email: string) =>
    db
      .select({
        id: superAdmins.id,
        passwordHash: superAdmins.passwordHash,
        twoFactorSecret: superAdmins.twoFactorSecret,
      })
      .from(superAdmins)
      .where(eq(superAdmins.email, email))
      .limit(1),
  findPendingPrincipal: async (id: string, orgId: string | null) =>
    orgId === null
      ? (
          await db
            .select({
              id: superAdmins.id,
              email: superAdmins.email,
              twoFactorSecret: superAdmins.twoFactorSecret,
            })
            .from(superAdmins)
            .where(eq(superAdmins.id, id))
            .limit(1)
        )[0]
      : (
          await db
            .select({
              id: users.id,
              orgId: users.orgId,
              email: users.email,
              role: users.role,
              twoFactorSecret: users.twoFactorSecret,
            })
            .from(users)
            .where(eq(users.id, id))
            .limit(1)
        )[0],
  setTwoFactorSecret: (id: string, orgId: string | null, secret: string) =>
    orgId === null
      ? db.update(superAdmins).set({ twoFactorSecret: secret }).where(eq(superAdmins.id, id))
      : db
          .update(users)
          .set({ twoFactorSecret: secret, updatedAt: new Date() })
          .where(eq(users.id, id)),
};

import { and, count, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '../../config/database';
import { orgs, superAdmins, users } from '../../db/schema';
import { ValidationError } from '../../utils/errors';

function rethrowDuplicateEmail(error: unknown): never {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? error.code
      : typeof error === 'object' && error !== null && 'cause' in error &&
          typeof error.cause === 'object' && error.cause !== null && 'code' in error.cause
        ? error.cause.code
        : undefined;
  if (code === '23505')
    throw new ValidationError('An account with this email already exists');
  throw error;
}
export const userRepository = {
  listOrganizationUsers: (orgId: string) => db.select({ id: users.id, orgId: users.orgId, email: users.email, role: users.role, active: users.active, createdAt: users.createdAt, updatedAt: users.updatedAt }).from(users).where(and(eq(users.orgId, orgId), eq(users.active, true))).orderBy(users.email),
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
    }).catch(rethrowDuplicateEmail),
  findUsersByEmail: (email: string) =>
    db
      .select({
        userId: users.id,
        orgId: users.orgId,
        passwordHash: users.passwordHash,
        twoFactorSecret: users.twoFactorSecret,
        tokenVersion: users.tokenVersion,
        active: users.active,
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
        tokenVersion: superAdmins.tokenVersion,
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
              twoFactorLastTimeStep: superAdmins.twoFactorLastTimeStep,
              tokenVersion: superAdmins.tokenVersion,
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
              twoFactorLastTimeStep: users.twoFactorLastTimeStep,
              tokenVersion: users.tokenVersion,
            })
            .from(users)
            .where(eq(users.id, id))
            .limit(1)
        )[0],
  setTwoFactorSecret: (id: string, orgId: string | null, secret: string) =>
    orgId === null
      ? db.update(superAdmins).set({ twoFactorSecret: secret, twoFactorLastTimeStep: null }).where(eq(superAdmins.id, id))
      : db
          .update(users)
          .set({ twoFactorSecret: secret, twoFactorLastTimeStep: null, updatedAt: new Date() })
          .where(eq(users.id, id)),
  async acceptTwoFactorTimeStep(
    id: string,
    orgId: string | null,
    timeStep: number,
    encryptedSecret?: string
  ) {
    const current = orgId === null ? superAdmins.twoFactorLastTimeStep : users.twoFactorLastTimeStep;
    const predicate = or(isNull(current), lt(current, timeStep));
    if (orgId === null) {
      const [updated] = await db.update(superAdmins)
        .set({ twoFactorLastTimeStep: timeStep, ...(encryptedSecret && { twoFactorSecret: encryptedSecret }) })
        .where(and(eq(superAdmins.id, id), predicate))
        .returning({ id: superAdmins.id });
      return Boolean(updated);
    }
    const [updated] = await db.update(users)
      .set({ twoFactorLastTimeStep: timeStep, ...(encryptedSecret && { twoFactorSecret: encryptedSecret }), updatedAt: new Date() })
      .where(and(eq(users.id, id), eq(users.orgId, orgId), predicate))
      .returning({ id: users.id });
    return Boolean(updated);
  },
  async findActiveTenantPrincipal(id: string, orgId: string) {
    return (await db.select({ id: users.id, role: users.role, tokenVersion: users.tokenVersion, orgStatus: orgs.status }).from(users)
      .innerJoin(orgs, eq(users.orgId, orgs.id))
      .where(and(eq(users.id, id), eq(users.orgId, orgId), eq(users.active, true))).limit(1))[0] ?? null;
  },
  async findCurrentSuperAdmin(id: string) {
    return (await db.select({ id: superAdmins.id, tokenVersion: superAdmins.tokenVersion })
      .from(superAdmins).where(eq(superAdmins.id, id)).limit(1))[0] ?? null;
  },
  async getProfile(userId: string, orgId: string | null) {
    if (orgId === null) {
      const [admin] = await db.select({ id: superAdmins.id, email: superAdmins.email }).from(superAdmins).where(eq(superAdmins.id, userId)).limit(1);
      return admin ? { ...admin, orgName: 'Platform' } : null;
    }
    const [user] = await db.select({ id: users.id, email: users.email, orgName: orgs.name }).from(users).innerJoin(orgs, eq(users.orgId, orgs.id)).where(and(eq(users.id, userId), eq(users.orgId, orgId), eq(users.active, true))).limit(1);
    return user ?? null;
  },
  async createOrganizationUser(input: { orgId: string; email: string; passwordHash: string; role: 'org_admin' | 'finance' | 'auditor' | 'team_lead' | 'developer' }) {
    try {
      const [user] = await db.insert(users).values({ ...input, active: true }).returning({ id: users.id, orgId: users.orgId, email: users.email, role: users.role, active: users.active, createdAt: users.createdAt });
      return user;
    } catch (error) {
      return rethrowDuplicateEmail(error);
    }
  },
  async findUserByEmail(email: string) {
    return (await db.select({ id: users.id, orgId: users.orgId, active: users.active }).from(users)
      .where(eq(users.email, email)).limit(1))[0] ?? null;
  },
  async reactivateOrganizationUser(input: { id: string; orgId: string; passwordHash: string; role: 'org_admin' | 'finance' | 'auditor' | 'team_lead' | 'developer' }) {
    const [user] = await db.update(users).set({
      active: true,
      role: input.role,
      passwordHash: input.passwordHash,
      tokenVersion: sql`${users.tokenVersion} + 1`,
      updatedAt: new Date(),
    }).where(and(eq(users.id, input.id), eq(users.orgId, input.orgId), eq(users.active, false)))
      .returning({ id: users.id, orgId: users.orgId, email: users.email, role: users.role, active: users.active, createdAt: users.createdAt, updatedAt: users.updatedAt });
    return user ?? null;
  },
  async findOrganizationUser(userId: string, orgId: string) {
    return (await db.select({ id: users.id, orgId: users.orgId, email: users.email, role: users.role, active: users.active, createdAt: users.createdAt, updatedAt: users.updatedAt })
      .from(users).where(and(eq(users.id, userId), eq(users.orgId, orgId))).limit(1))[0] ?? null;
  },
  async countActiveOrgAdmins(orgId: string) {
    const [result] = await db.select({ count: count() }).from(users)
      .where(and(eq(users.orgId, orgId), eq(users.role, 'org_admin'), eq(users.active, true)));
    return Number(result?.count ?? 0);
  },
  async updateOrganizationUserRole(userId: string, orgId: string, role: 'org_admin' | 'finance' | 'auditor' | 'team_lead' | 'developer') {
    const [user] = await db.update(users).set({ role, updatedAt: new Date() })
      .where(and(eq(users.id, userId), eq(users.orgId, orgId))).returning({ id: users.id, orgId: users.orgId, email: users.email, role: users.role, active: users.active, updatedAt: users.updatedAt });
    return user ?? null;
  },
  async deactivateOrganizationUser(userId: string, orgId: string) {
    const [user] = await db.update(users).set({ active: false, updatedAt: new Date() })
      .where(and(eq(users.id, userId), eq(users.orgId, orgId), eq(users.active, true)))
      .returning({ id: users.id, email: users.email, role: users.role, active: users.active });
    return user ?? null;
  },
  async updatePassword(userId: string, orgId: string, passwordHash: string) {
    await db.update(users).set({ passwordHash, tokenVersion: sql`${users.tokenVersion} + 1`, updatedAt: new Date() })
      .where(and(eq(users.id, userId), eq(users.orgId, orgId), eq(users.active, true)));
  },
  async findPasswordForActiveUser(userId: string, orgId: string) {
    return (await db.select({ passwordHash: users.passwordHash }).from(users)
      .where(and(eq(users.id, userId), eq(users.orgId, orgId), eq(users.active, true))).limit(1))[0] ?? null;
  },
  async findPasswordForSuperAdmin(userId: string) {
    return (await db.select({ passwordHash: superAdmins.passwordHash }).from(superAdmins).where(eq(superAdmins.id, userId)).limit(1))[0] ?? null;
  },
  async updateSuperAdminPassword(userId: string, passwordHash: string) {
    await db.update(superAdmins).set({ passwordHash, tokenVersion: sql`${superAdmins.tokenVersion} + 1` }).where(eq(superAdmins.id, userId));
  },
};

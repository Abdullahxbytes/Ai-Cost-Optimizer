import {
  AnyPgColumn,
  boolean,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
export const roleEnum = pgEnum('role', [
  'super_admin',
  'org_admin',
  'team_lead',
  'developer',
  'finance',
  'auditor',
]);
export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id').notNull(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: roleEnum('role').notNull(),
    twoFactorSecret: text('two_factor_secret'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ uqUsersOrgEmail: uniqueIndex('idx_users_org_id_email_unique').on(t.orgId, t.email) })
);

/** System-level administrators remain separate from tenant users. */
export const superAdmins = pgTable('super_admins', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  twoFactorSecret: text('two_factor_secret'),
  createdBy: uuid('created_by').references((): AnyPgColumn => superAdmins.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/** Organization-approved support access for system-level administrators. */
export const accessGrants = pgTable('access_grants', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull(),
  grantedTo: uuid('granted_to').notNull(),
  grantedBy: uuid('granted_by').notNull(),
  reason: text('reason').notNull(),
  active: boolean('active').default(true).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

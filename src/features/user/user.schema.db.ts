import {
  AnyPgColumn,
  boolean,
  pgEnum,
  pgTable,
  text,
  timestamp,
  integer,
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
    active: boolean('active').default(true).notNull(),
    tokenVersion: integer('token_version').default(0).notNull(),
    twoFactorSecret: text('two_factor_secret'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uqUsersOrgEmail: uniqueIndex('idx_users_org_id_email_unique').on(t.orgId, t.email),
    // Until verified email ownership exists, a tenant email may belong to only one organization.
    uqUsersEmail: uniqueIndex('uq_users_email').on(t.email),
  })
);

/** System-level administrators remain separate from tenant users. */
export const superAdmins = pgTable('super_admins', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  twoFactorSecret: text('two_factor_secret'),
  tokenVersion: integer('token_version').default(0).notNull(),
  // A removed Super Admin must not block hard deletion of their successors.
  createdBy: uuid('created_by').references((): AnyPgColumn => superAdmins.id, { onDelete: 'set null' }),
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

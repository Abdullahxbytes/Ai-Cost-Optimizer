import { check, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
export const teamStatusEnum = pgEnum('team_status', ['active', 'archived']);
export const teamDeletionModeEnum = pgEnum('team_deletion_mode', ['purge_now', 'archive_15_days']);

export const teams = pgTable(
  'teams',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id').notNull(),
    name: text('name').notNull(),
    parentTeamId: uuid('parent_team_id'),
    teamLeadId: uuid('team_lead_id'),
    status: teamStatusEnum('status').default('active').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    purgeAt: timestamp('purge_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    chkTeamsNoSelfParent: check(
      'chk_teams_no_self_parent',
      sql`${t.parentTeamId} is null or ${t.parentTeamId} <> ${t.id}`
    ),
  })
);

export const teamMembers = pgTable('team_members', {
  id: uuid('id').defaultRandom().primaryKey(),
  teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ uniqueMember: uniqueIndex('team_members_team_user_unique').on(table.teamId, table.userId) }));

export const teamDeletions = pgTable('team_deletions', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull(),
  teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  mode: teamDeletionModeEnum('mode').notNull(),
  requestedBy: uuid('requested_by').notNull(),
  requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
  purgeAt: timestamp('purge_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

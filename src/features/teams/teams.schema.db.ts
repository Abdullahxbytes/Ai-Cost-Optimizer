import { check, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
export const teams = pgTable(
  'teams',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id').notNull(),
    name: text('name').notNull(),
    parentTeamId: uuid('parent_team_id'),
    teamLeadId: uuid('team_lead_id'),
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

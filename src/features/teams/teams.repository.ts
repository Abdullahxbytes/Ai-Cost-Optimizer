import { and, eq, inArray, isNull, lt } from 'drizzle-orm';
import { db } from '../../config/database';
import { users } from '../user/user.schema.db';
import { teamDeletions, teamMembers, teams } from './teams.schema.db';

export type TeamCreateInput = { orgId: string; name: string; teamLeadId: string; parentTeamId?: string };
export type TeamUpdate = { name?: string; teamLeadId?: string };

const teamFields = { id: teams.id, orgId: teams.orgId, name: teams.name, parentTeamId: teams.parentTeamId, teamLeadId: teams.teamLeadId, status: teams.status, archivedAt: teams.archivedAt, purgeAt: teams.purgeAt };
const teamListFields = { ...teamFields, teamLeadEmail: users.email };

export const teamsRepository = {
  async create(input: TeamCreateInput) {
    const [team] = await db.insert(teams).values(input).returning(teamFields);
    return team;
  },

  async findById(teamId: string) {
    const [team] = await db.select(teamFields).from(teams).where(eq(teams.id, teamId)).limit(1);
    return team ?? null;
  },

  async update(teamId: string, update: TeamUpdate) {
    const [team] = await db
      .update(teams)
      .set({ ...update, updatedAt: new Date() })
      .where(eq(teams.id, teamId))
      .returning(teamFields);
    return team ?? null;
  },

  async listForOrganization(orgId: string) {
    return db.select(teamListFields).from(teams).leftJoin(users, eq(teams.teamLeadId, users.id)).where(and(eq(teams.orgId, orgId), eq(teams.status, 'active')));
  },

  async listLedBy(userId: string) {
    return db.select(teamListFields).from(teams).leftJoin(users, eq(teams.teamLeadId, users.id)).where(and(eq(teams.teamLeadId, userId), eq(teams.status, 'active')));
  },

  async listForDeveloper(userId: string, orgId: string) {
    return db
      .selectDistinct(teamListFields)
      .from(teams)
      .innerJoin(teamMembers, eq(teamMembers.teamId, teams.id))
      .leftJoin(users, eq(teams.teamLeadId, users.id))
      .where(and(eq(teams.orgId, orgId), eq(teams.status, 'active'), eq(teamMembers.userId, userId)));
  },

  async listMembers(teamId: string) {
    return db.select({ id: users.id, email: users.email, role: users.role, createdAt: teamMembers.createdAt })
      .from(teamMembers).innerJoin(users, eq(teamMembers.userId, users.id))
      .where(eq(teamMembers.teamId, teamId));
  },
  async addMember(teamId: string, userId: string) {
    await db.insert(teamMembers).values({ teamId, userId }).onConflictDoNothing();
  },
  async removeMember(teamId: string, userId: string) {
    await db.delete(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
  },
  async findActiveDeveloper(userId: string, orgId: string) {
    const [user] = await db.select({ id: users.id, email: users.email }).from(users)
      .where(and(eq(users.id, userId), eq(users.orgId, orgId), eq(users.role, 'developer'), eq(users.active, true))).limit(1);
    return user ?? null;
  },
  async listActiveDevelopers(orgId: string) {
    return db.select({ id: users.id, email: users.email, role: users.role, active: users.active }).from(users)
      .where(and(eq(users.orgId, orgId), eq(users.role, 'developer'), eq(users.active, true)));
  },
  async createDeletion(input: { orgId: string; teamId: string; mode: 'purge_now' | 'archive_15_days'; requestedBy: string; purgeAt?: Date | null }) {
    const [deletion] = await db.insert(teamDeletions).values(input).returning();
    return deletion;
  },
  async findDeletion(deletionId: string) {
    const [deletion] = await db.select().from(teamDeletions).where(eq(teamDeletions.id, deletionId)).limit(1);
    return deletion ?? null;
  },
  async listPendingArchives(orgId: string) {
    return db.select().from(teamDeletions).where(and(eq(teamDeletions.orgId, orgId), eq(teamDeletions.mode, 'archive_15_days'), isNull(teamDeletions.completedAt)));
  },
  async findExpiredArchives(now: Date) {
    return db.select().from(teamDeletions).where(and(eq(teamDeletions.mode, 'archive_15_days'), isNull(teamDeletions.completedAt), lt(teamDeletions.purgeAt, now)));
  },

  async isOrganizationMember(userId: string, orgId: string): Promise<boolean> {
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.orgId, orgId), eq(users.active, true)))
      .limit(1);
    return Boolean(user);
  },
};

import { and, eq } from 'drizzle-orm';
import { db } from '../../config/database';
import { agents } from '../agents/agents.schema.db';
import { users } from '../user/user.schema.db';
import { teams } from './teams.schema.db';

export type TeamCreateInput = { orgId: string; name: string; teamLeadId: string; parentTeamId?: string };
export type TeamUpdate = { name?: string; teamLeadId?: string };

const teamFields = { id: teams.id, orgId: teams.orgId, name: teams.name, parentTeamId: teams.parentTeamId, teamLeadId: teams.teamLeadId };

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
    return db.select(teamFields).from(teams).where(eq(teams.orgId, orgId));
  },

  async listLedBy(userId: string) {
    return db.select(teamFields).from(teams).where(eq(teams.teamLeadId, userId));
  },

  async listForDeveloper(userId: string, orgId: string) {
    return db
      .selectDistinct(teamFields)
      .from(teams)
      .innerJoin(agents, eq(agents.teamId, teams.id))
      .where(and(eq(teams.orgId, orgId), eq(agents.ownerUserId, userId)));
  },

  async isOrganizationMember(userId: string, orgId: string): Promise<boolean> {
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.orgId, orgId)))
      .limit(1);
    return Boolean(user);
  },
};

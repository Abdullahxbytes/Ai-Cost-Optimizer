import { AuthenticatedUser } from '../../middleware/auth';
import { NotFoundError, ValidationError } from '../../utils/errors';
import { teamsRepository } from './teams.repository';

async function assertOrganizationMember(userId: string, orgId: string) {
  if (!(await teamsRepository.isOrganizationMember(userId, orgId))) {
    throw new ValidationError('teamLeadId must belong to this organization');
  }
}

export const teamsService = {
  async createTopLevel(orgId: string, creatorId: string, name: string, teamLeadId?: string) {
    const leadId = teamLeadId ?? creatorId;
    await assertOrganizationMember(leadId, orgId);
    return teamsRepository.create({ orgId, name, teamLeadId: leadId });
  },

  async get(teamId: string) {
    const team = await teamsRepository.findById(teamId);
    if (!team) throw new NotFoundError('Team not found');
    return team;
  },

  async list(user: AuthenticatedUser) {
    if (!user.orgId) return [];
    if (user.role === 'org_admin') return teamsRepository.listForOrganization(user.orgId);
    if (user.role === 'team_lead') return teamsRepository.listLedBy(user.id);
    if (user.role === 'developer') return teamsRepository.listForDeveloper(user.id, user.orgId);
    return [];
  },

  async update(teamId: string, update: { name?: string; teamLeadId?: string }) {
    const current = await this.get(teamId);
    if (update.teamLeadId) await assertOrganizationMember(update.teamLeadId, current.orgId);
    const team = await teamsRepository.update(teamId, update);
    if (!team) throw new NotFoundError('Team not found');
    return team;
  },

  async createSubTeam(parentTeamId: string, creatorId: string, name: string, teamLeadId?: string) {
    const parent = await this.get(parentTeamId);
    if (parent.parentTeamId) throw new ValidationError('Cannot create a sub-team under a sub-team');
    const leadId = teamLeadId ?? creatorId;
    await assertOrganizationMember(leadId, parent.orgId);
    return teamsRepository.create({ orgId: parent.orgId, name, teamLeadId: leadId, parentTeamId });
  },
};

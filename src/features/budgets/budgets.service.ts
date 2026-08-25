import { AuthenticatedUser } from '../../middleware/auth';
import { canAccessAgent, canAccessTeam } from '../../middleware/rbac';
import { ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors';
import { agentsRepository } from '../agents/agents.repository';
import { orgsRepository } from '../orgs/orgs.repository';
import { BudgetRecord, BudgetScope, budgetsRepository } from './budgets.repository';

async function assertAgentBudgetFitsTeam(agentId: string, proposedAmount: number, excludeBudgetId?: string) {
  const agent = await agentsRepository.findById(agentId);
  if (!agent?.teamId) throw new ValidationError('Agent must belong to a team for an agent budget');
  const teamBudget = await budgetsRepository.findByScope('team', agent.teamId);
  if (!teamBudget) return;
  const existing = await budgetsRepository.sumAgentBudgetsForTeam(agent.teamId, excludeBudgetId);
  if (existing + proposedAmount > teamBudget.limitAmount) {
    throw new ValidationError(`Agent budgets for this team cannot exceed its ${teamBudget.limitAmount} limit`);
  }
}

async function assertBudgetVisible(user: AuthenticatedUser, budget: BudgetRecord) {
  if (user.role === 'org_admin') return;
  if (budget.scope === 'agent' && (await canAccessAgent(user, budget.scopeId))) return;
  if (budget.scope === 'team' && (await canAccessTeam(user, budget.scopeId))) return;
  throw new ForbiddenError('Budget access denied');
}

export const budgetsService = {
  async create(user: AuthenticatedUser, input: { scope: BudgetScope; scopeId: string; limitAmount: number; period: 'daily' | 'monthly' }) {
    const organization = await orgsRepository.findById(user.orgId!);
    if (!organization) throw new NotFoundError('Organization not found');
    if (input.scope === 'org' && input.scopeId !== user.orgId) throw new ForbiddenError('Organization access denied');
    if (input.scope === 'team' && !(await canAccessTeam(user, input.scopeId))) throw new ForbiddenError('Team access denied');
    if (input.scope === 'agent') {
      const agent = await agentsRepository.findById(input.scopeId);
      if (!agent || agent.orgId !== user.orgId) throw new NotFoundError('Agent not found');
      if (user.role === 'team_lead' && !(await canAccessTeam(user, agent.teamId!))) throw new ForbiddenError('Team access denied');
      await assertAgentBudgetFitsTeam(input.scopeId, input.limitAmount);
    }
    if (user.role === 'team_lead' && input.scope === 'org') throw new ForbiddenError('Team Leads cannot create organization budgets');
    if (await budgetsRepository.findByScope(input.scope, input.scopeId)) throw new ValidationError('A budget already exists for this scope');
    return budgetsRepository.createBudget({ ...input, orgId: user.orgId!, resetTimezone: organization.timezone });
  },

  async list(user: AuthenticatedUser) {
    if (user.role === 'org_admin') return budgetsRepository.listByOrganization(user.orgId!);
    if (user.role === 'team_lead') {
      const teamIds = await agentsRepository.listTeamIdsLedBy(user.id);
      const agentIds = (await Promise.all(teamIds.map((teamId) => agentsRepository.listByTeams([teamId])))).flat().map((agent) => agent.id);
      return budgetsRepository.listByScopes(user.orgId!, [{ scope: 'team', scopeIds: teamIds }, { scope: 'agent', scopeIds: agentIds }]);
    }
    const agentIds = (await agentsRepository.listByOwner(user.id)).map((agent) => agent.id);
    return budgetsRepository.listByScopes(user.orgId!, [{ scope: 'agent', scopeIds: agentIds }]);
  },

  async update(user: AuthenticatedUser, budgetId: string, limitAmount: number) {
    const budget = await budgetsRepository.findById(budgetId);
    if (!budget) throw new NotFoundError('Budget not found');
    if (budget.orgId !== user.orgId) throw new ForbiddenError('Organization access denied');
    if (budget.scope === 'agent') await assertAgentBudgetFitsTeam(budget.scopeId, limitAmount, budget.id);
    return budgetsRepository.updateBudget(budgetId, limitAmount);
  },

  async requestIncrease(user: AuthenticatedUser, budgetId: string, requestedAmount: number) {
    const budget = await budgetsRepository.findById(budgetId);
    if (!budget) throw new NotFoundError('Budget not found');
    await assertBudgetVisible(user, budget);
    if (requestedAmount <= budget.limitAmount) throw new ValidationError('requestedAmount must exceed the current budget limit');
    return budgetsRepository.createBudgetRequest({ orgId: budget.orgId, budgetId, requestedBy: user.id, requestedAmount });
  },

  listPendingRequests: (orgId: string) => budgetsRepository.listPendingBudgetRequests(orgId),

  async decideRequest(requestId: string, approved: boolean, actor: AuthenticatedUser) {
    const request = await budgetsRepository.findBudgetRequest(requestId);
    if (!request) throw new NotFoundError('Budget request not found');
    if (request.orgId !== actor.orgId) throw new ForbiddenError('Organization access denied');
    if (request.status !== 'pending') throw new ValidationError('Budget request has already been decided');
    if (approved) {
      const budget = await budgetsRepository.findById(request.budgetId);
      if (!budget) throw new NotFoundError('Budget not found');
      if (budget.scope === 'agent') await assertAgentBudgetFitsTeam(budget.scopeId, Number(request.requestedAmount), budget.id);
      await budgetsRepository.updateBudget(budget.id, Number(request.requestedAmount));
    }
    return budgetsRepository.updateBudgetRequestStatus(requestId, approved ? 'approved' : 'rejected', actor.id);
  },
};

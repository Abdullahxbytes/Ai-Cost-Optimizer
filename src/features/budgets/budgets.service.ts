import { AuthenticatedUser } from '../../middleware/auth';
import { canAccessAgent, canAccessTeam } from '../../middleware/rbac';
import { ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors';
import { agentsRepository } from '../agents/agents.repository';
import { orgsRepository } from '../orgs/orgs.repository';
import { BudgetRecord, BudgetScope, budgetsRepository } from './budgets.repository';
import { redis } from '../../config/redis';
import { getBudgetSpendKey } from './budget.redis';
import { auditRepository } from '../audit/audit.repository';

type BudgetWithCurrentSpend = BudgetRecord & { currentSpend: number; percentUsed: number };
type SpendScopedBudget = Pick<
  BudgetRecord,
  'scope' | 'scopeId' | 'limitAmount' | 'period' | 'resetTimezone'
>;
const MINIMUM_DAILY_BUDGET_USD = 0.00001;

function assertMinimumBudget(period: 'daily' | 'monthly', limitAmount: number) {
  if (period === 'daily' && limitAmount < MINIMUM_DAILY_BUDGET_USD) {
    throw new ValidationError('Daily budgets must be at least $0.00001');
  }
}

async function assertLimitExceedsCurrentSpend(budget: SpendScopedBudget, limitAmount: number) {
  const currentSpend = Number(
    (await redis.get(getBudgetSpendKey(budget.scope, budget.scopeId, budget))) ?? '0'
  );

  if (limitAmount <= currentSpend) {
    throw new ValidationError(
      `Budget limit must be greater than the current spend of $${currentSpend.toFixed(5)}`
    );
  }
}

async function addCurrentSpend(budgets: BudgetRecord[]): Promise<BudgetWithCurrentSpend[]> {
  // One independent Redis read per budget is appropriate for the small current list sizes.
  // A future high-volume list endpoint can replace this with MGET/pipelining without changing the response shape.
  return Promise.all(
    budgets.map(async (budget) => {
      const currentSpend = Number(
        (await redis.get(getBudgetSpendKey(budget.scope, budget.scopeId, budget))) ?? '0'
      );
      return { ...budget, currentSpend, percentUsed: (currentSpend / budget.limitAmount) * 100 };
    })
  );
}

async function getAgentTeamId(agentId: string): Promise<string> {
  const agent = await agentsRepository.findById(agentId);
  if (!agent?.teamId) throw new ValidationError('Agent must belong to a team for an agent budget');
  return agent.teamId;
}

async function assertBudgetVisible(user: AuthenticatedUser, budget: BudgetRecord) {
  if (user.role === 'org_admin') return;
  if (budget.scope === 'agent' && (await canAccessAgent(user, budget.scopeId))) return;
  if (budget.scope === 'team' && (await canAccessTeam(user, budget.scopeId))) return;
  throw new ForbiddenError('Budget access denied');
}

export const budgetsService = {
  async create(
    user: AuthenticatedUser,
    input: { scope: BudgetScope; scopeId: string; limitAmount: number; period: 'daily' | 'monthly' }
  ) {
    assertMinimumBudget(input.period, input.limitAmount);
    const organization = await orgsRepository.findById(user.orgId!);
    if (!organization) throw new NotFoundError('Organization not found');
    if (input.scope === 'org' && input.scopeId !== user.orgId)
      throw new ForbiddenError('Organization access denied');
    if (input.scope === 'team' && !(await canAccessTeam(user, input.scopeId)))
      throw new ForbiddenError('Team access denied');
    if (input.scope === 'agent') {
      const agent = await agentsRepository.findById(input.scopeId);
      if (!agent || agent.orgId !== user.orgId) throw new NotFoundError('Agent not found');
      const teamId = await getAgentTeamId(input.scopeId);
      if (user.role === 'team_lead' && !(await canAccessTeam(user, teamId)))
        throw new ForbiddenError('Team access denied');
      if (await budgetsRepository.findByScope(input.scope, input.scopeId))
        throw new ValidationError('A budget already exists for this scope');
      await assertLimitExceedsCurrentSpend(
        { ...input, resetTimezone: organization.timezone },
        input.limitAmount
      );
      const budget = await budgetsRepository.createAgentBudgetWithinTeamLimit({
        ...input,
        orgId: user.orgId!,
        resetTimezone: organization.timezone,
        teamId,
      });
      await auditRepository.record({
        orgId: user.orgId!,
        actorUserId: user.id,
        eventType: 'budget_created',
        targetType: 'budget',
        targetId: budget.id,
        metadata: input,
      });
      return budget;
    }
    if (user.role === 'team_lead' && input.scope === 'org')
      throw new ForbiddenError('Team Leads cannot create organization budgets');
    if (await budgetsRepository.findByScope(input.scope, input.scopeId))
      throw new ValidationError('A budget already exists for this scope');
    await assertLimitExceedsCurrentSpend(
      { ...input, resetTimezone: organization.timezone },
      input.limitAmount
    );
    const budget = await budgetsRepository.createBudget({
      ...input,
      orgId: user.orgId!,
      resetTimezone: organization.timezone,
    });
    await auditRepository.record({
      orgId: user.orgId!,
      actorUserId: user.id,
      eventType: 'budget_created',
      targetType: 'budget',
      targetId: budget.id,
      metadata: input,
    });
    return budget;
  },

  async list(user: AuthenticatedUser) {
    if (user.role === 'org_admin')
      return addCurrentSpend(await budgetsRepository.listByOrganization(user.orgId!));
    if (user.role === 'team_lead') {
      const teamIds = await agentsRepository.listTeamIdsLedBy(user.id);
      const agentIds = (
        await Promise.all(teamIds.map((teamId) => agentsRepository.listByTeams([teamId])))
      )
        .flat()
        .map((agent) => agent.id);
      return addCurrentSpend(
        await budgetsRepository.listByScopes(user.orgId!, [
          { scope: 'team', scopeIds: teamIds },
          { scope: 'agent', scopeIds: agentIds },
        ])
      );
    }
    const agentIds = (await agentsRepository.listByOwner(user.id)).map((agent) => agent.id);
    return addCurrentSpend(
      await budgetsRepository.listByScopes(user.orgId!, [{ scope: 'agent', scopeIds: agentIds }])
    );
  },

  async update(user: AuthenticatedUser, budgetId: string, limitAmount: number) {
    const budget = await budgetsRepository.findById(budgetId);
    if (!budget) throw new NotFoundError('Budget not found');
    if (budget.orgId !== user.orgId) throw new ForbiddenError('Organization access denied');
    assertMinimumBudget(budget.period, limitAmount);
    await assertLimitExceedsCurrentSpend(budget, limitAmount);
    if (budget.scope === 'agent') {
      const teamId = await getAgentTeamId(budget.scopeId);
      const updated = await budgetsRepository.updateAgentBudgetWithinTeamLimit({
        budgetId,
        teamId,
        limitAmount,
      });
      await auditRepository.record({
        orgId: user.orgId!,
        actorUserId: user.id,
        eventType: 'budget_updated',
        targetType: 'budget',
        targetId: budgetId,
        metadata: { limitAmount },
      });
      return updated;
    }
    const updated = await budgetsRepository.updateBudget(budgetId, limitAmount);
    await auditRepository.record({
      orgId: user.orgId!,
      actorUserId: user.id,
      eventType: 'budget_updated',
      targetType: 'budget',
      targetId: budgetId,
      metadata: { limitAmount },
    });
    return updated;
  },

  async remove(user: AuthenticatedUser, budgetId: string) {
    const budget = await budgetsRepository.findById(budgetId);
    if (!budget) throw new NotFoundError('Budget not found');
    if (budget.orgId !== user.orgId) throw new ForbiddenError('Organization access denied');
    const removed = await budgetsRepository.removeBudget(budgetId);
    await auditRepository.record({
      orgId: user.orgId!,
      actorUserId: user.id,
      eventType: 'budget_deleted',
      targetType: 'budget',
      targetId: budgetId,
      metadata: {
        scope: budget.scope,
        scopeId: budget.scopeId,
        limitAmount: budget.limitAmount,
        period: budget.period,
      },
    });
    return removed;
  },

  async requestIncrease(user: AuthenticatedUser, budgetId: string, requestedAmount: number) {
    const budget = await budgetsRepository.findById(budgetId);
    if (!budget) throw new NotFoundError('Budget not found');
    await assertBudgetVisible(user, budget);
    if (requestedAmount <= budget.limitAmount)
      throw new ValidationError('requestedAmount must exceed the current budget limit');
    await assertLimitExceedsCurrentSpend(budget, requestedAmount);
    return budgetsRepository.createBudgetRequest({
      orgId: budget.orgId,
      budgetId,
      requestedBy: user.id,
      requestedAmount,
    });
  },

  listPendingRequests: (orgId: string) => budgetsRepository.listPendingBudgetRequests(orgId),

  async decideRequest(requestId: string, approved: boolean, actor: AuthenticatedUser) {
    const request = await budgetsRepository.findBudgetRequest(requestId);
    if (!request) throw new NotFoundError('Budget request not found');
    if (request.orgId !== actor.orgId) throw new ForbiddenError('Organization access denied');
    if (request.status !== 'pending')
      throw new ValidationError('Budget request has already been decided');
    if (approved) {
      const budget = await budgetsRepository.findById(request.budgetId);
      if (!budget) throw new NotFoundError('Budget not found');
      assertMinimumBudget(budget.period, Number(request.requestedAmount));
      await assertLimitExceedsCurrentSpend(budget, Number(request.requestedAmount));
      if (budget.scope === 'agent') {
        const teamId = await getAgentTeamId(budget.scopeId);
        await budgetsRepository.updateAgentBudgetWithinTeamLimit({
          budgetId: budget.id,
          teamId,
          limitAmount: Number(request.requestedAmount),
        });
      } else {
        await budgetsRepository.updateBudget(budget.id, Number(request.requestedAmount));
      }
    }
    return budgetsRepository.updateBudgetRequestStatus(
      requestId,
      approved ? 'approved' : 'rejected',
      actor.id
    );
  },
};

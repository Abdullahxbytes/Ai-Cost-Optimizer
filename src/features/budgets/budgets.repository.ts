import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { db } from '../../config/database';
import { agents } from '../agents/agents.schema.db';
import { teams } from '../teams/teams.schema.db';
import { budgetRequests, budgets } from './budgets.schema.db';
import { ValidationError } from '../../utils/errors';

export type BudgetScope = 'org' | 'team' | 'agent';

export type Budget = {
  id?: string;
  orgId?: string;
  scope?: BudgetScope;
  scopeId?: string;
  limitAmount: number;
  period: 'daily' | 'monthly';
  resetTimezone: string;
};

export type BudgetRecord = Required<Budget>;
export type BudgetListRecord = BudgetRecord & { scopeName: string | null };
const budgetFields = {
  id: budgets.id,
  orgId: budgets.orgId,
  scope: budgets.scope,
  scopeId: budgets.scopeId,
  limitAmount: budgets.limitAmount,
  period: budgets.period,
  resetTimezone: budgets.resetTimezone,
};
const budgetListFields = {
  ...budgetFields,
  scopeName: sql<string | null>`coalesce(${teams.name}, ${agents.name})`,
};

function toBudget(
  row: typeof budgetFields extends never
    ? never
    : {
        id: string;
        orgId: string;
        scope: BudgetScope;
        scopeId: string;
        limitAmount: string;
        period: 'daily' | 'monthly';
        resetTimezone: string;
      }
): BudgetRecord {
  return { ...row, limitAmount: Number(row.limitAmount) };
}
function toBudgetList(row: {
  id: string;
  orgId: string;
  scope: BudgetScope;
  scopeId: string;
  limitAmount: string;
  period: 'daily' | 'monthly';
  resetTimezone: string;
  scopeName: string | null;
}): BudgetListRecord {
  return { ...toBudget(row), scopeName: row.scopeName };
}

export const budgetsRepository = {
  async getBudget(scope: BudgetScope, scopeId: string): Promise<Budget | null> {
    const [budget] = await db
      .select({
        limitAmount: budgets.limitAmount,
        period: budgets.period,
        resetTimezone: budgets.resetTimezone,
      })
      .from(budgets)
      .where(and(eq(budgets.scope, scope), eq(budgets.scopeId, scopeId)))
      .limit(1);

    if (!budget) return null;

    return {
      limitAmount: Number(budget.limitAmount),
      period: budget.period,
      resetTimezone: budget.resetTimezone,
    };
  },

  async findById(budgetId: string): Promise<BudgetRecord | null> {
    const [budget] = await db
      .select(budgetFields)
      .from(budgets)
      .where(eq(budgets.id, budgetId))
      .limit(1);
    return budget ? toBudget(budget as never) : null;
  },

  async findByScope(scope: BudgetScope, scopeId: string): Promise<BudgetRecord | null> {
    const [budget] = await db
      .select(budgetFields)
      .from(budgets)
      .where(and(eq(budgets.scope, scope), eq(budgets.scopeId, scopeId)))
      .limit(1);
    return budget ? toBudget(budget as never) : null;
  },

  async createBudget(input: {
    orgId: string;
    scope: BudgetScope;
    scopeId: string;
    limitAmount: number;
    period: 'daily' | 'monthly';
    resetTimezone: string;
  }): Promise<BudgetRecord> {
    try {
      const [budget] = await db
        .insert(budgets)
        .values({ ...input, limitAmount: String(input.limitAmount) })
        .returning(budgetFields);
      return toBudget(budget as never);
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505')
        throw new ValidationError('A budget already exists for this scope');
      throw error;
    }
  },

  async createAgentBudgetWithinTeamLimit(input: {
    orgId: string;
    scopeId: string;
    limitAmount: number;
    period: 'daily' | 'monthly';
    resetTimezone: string;
    teamId: string;
  }): Promise<BudgetRecord> {
    return db.transaction(async (tx) => {
      // The team-budget row is the lock anchor: competing agent-budget mutations for one team serialize here.
      await tx.execute(
        sql`select id from budgets where scope = 'team' and scope_id = ${input.teamId} for update`
      );
      const [teamBudget] = await tx
        .select(budgetFields)
        .from(budgets)
        .where(and(eq(budgets.scope, 'team'), eq(budgets.scopeId, input.teamId)))
        .limit(1);
      if (teamBudget) {
        const [result] = await tx
          .select({ total: sql<string>`coalesce(sum(${budgets.limitAmount}), 0)` })
          .from(budgets)
          .innerJoin(agents, eq(budgets.scopeId, agents.id))
          .where(and(eq(agents.teamId, input.teamId), eq(budgets.scope, 'agent')));
        if (Number(result?.total ?? 0) + input.limitAmount > Number(teamBudget.limitAmount))
          throw new ValidationError(
            `Agent budgets for this team cannot exceed its ${teamBudget.limitAmount} limit`
          );
      }
      const [budget] = await tx
        .insert(budgets)
        .values({
          orgId: input.orgId,
          scope: 'agent',
          scopeId: input.scopeId,
          limitAmount: String(input.limitAmount),
          period: input.period,
          resetTimezone: input.resetTimezone,
        })
        .returning(budgetFields);
      return toBudget(budget as never);
    });
  },

  async updateBudget(budgetId: string, limitAmount: number): Promise<BudgetRecord | null> {
    const [budget] = await db
      .update(budgets)
      .set({ limitAmount: String(limitAmount), updatedAt: new Date() })
      .where(eq(budgets.id, budgetId))
      .returning(budgetFields);
    return budget ? toBudget(budget as never) : null;
  },

  async removeBudget(budgetId: string): Promise<BudgetRecord | null> {
    return db.transaction(async (tx) => {
      await tx.delete(budgetRequests).where(eq(budgetRequests.budgetId, budgetId));
      const [budget] = await tx
        .delete(budgets)
        .where(eq(budgets.id, budgetId))
        .returning(budgetFields);
      return budget ? toBudget(budget as never) : null;
    });
  },

  async updateAgentBudgetWithinTeamLimit(input: {
    budgetId: string;
    teamId: string;
    limitAmount: number;
  }): Promise<BudgetRecord | null> {
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from budgets where scope = 'team' and scope_id = ${input.teamId} for update`
      );
      const [teamBudget] = await tx
        .select(budgetFields)
        .from(budgets)
        .where(and(eq(budgets.scope, 'team'), eq(budgets.scopeId, input.teamId)))
        .limit(1);
      if (teamBudget) {
        const [result] = await tx
          .select({ total: sql<string>`coalesce(sum(${budgets.limitAmount}), 0)` })
          .from(budgets)
          .innerJoin(agents, eq(budgets.scopeId, agents.id))
          .where(
            and(
              eq(agents.teamId, input.teamId),
              eq(budgets.scope, 'agent'),
              ne(budgets.id, input.budgetId)
            )
          );
        if (Number(result?.total ?? 0) + input.limitAmount > Number(teamBudget.limitAmount))
          throw new ValidationError(
            `Agent budgets for this team cannot exceed its ${teamBudget.limitAmount} limit`
          );
      }
      const [budget] = await tx
        .update(budgets)
        .set({ limitAmount: String(input.limitAmount), updatedAt: new Date() })
        .where(eq(budgets.id, input.budgetId))
        .returning(budgetFields);
      return budget ? toBudget(budget as never) : null;
    });
  },

  async listByScopes(
    orgId: string,
    scopes: Array<{ scope: BudgetScope; scopeIds: string[] }>
  ): Promise<BudgetListRecord[]> {
    const results = await Promise.all(
      scopes
        .filter((entry) => entry.scopeIds.length)
        .map(async (entry) => {
          const rows = await db
            .select(budgetListFields)
            .from(budgets)
            .leftJoin(teams, and(eq(budgets.scope, 'team'), eq(budgets.scopeId, teams.id)))
            .leftJoin(agents, and(eq(budgets.scope, 'agent'), eq(budgets.scopeId, agents.id)))
            .where(
              and(
                eq(budgets.orgId, orgId),
                eq(budgets.scope, entry.scope),
                inArray(budgets.scopeId, entry.scopeIds)
              )
            );
          return rows.map((row) => toBudgetList(row as never));
        })
    );
    return results.flat();
  },
  async listByOrganization(orgId: string): Promise<BudgetListRecord[]> {
    const rows = await db
      .select(budgetListFields)
      .from(budgets)
      .leftJoin(teams, and(eq(budgets.scope, 'team'), eq(budgets.scopeId, teams.id)))
      .leftJoin(agents, and(eq(budgets.scope, 'agent'), eq(budgets.scopeId, agents.id)))
      .where(eq(budgets.orgId, orgId));
    return rows.map((row) => toBudgetList(row as never));
  },

  async sumAgentBudgetsForTeam(teamId: string, excludeBudgetId?: string): Promise<number> {
    const conditions = [eq(agents.teamId, teamId), eq(budgets.scope, 'agent')];
    if (excludeBudgetId) conditions.push(ne(budgets.id, excludeBudgetId));
    const [result] = await db
      .select({ total: sql<string>`coalesce(sum(${budgets.limitAmount}), 0)` })
      .from(budgets)
      .innerJoin(agents, eq(budgets.scopeId, agents.id))
      .where(and(...conditions));
    return Number(result?.total ?? 0);
  },

  async createBudgetRequest(input: {
    orgId: string;
    budgetId: string;
    requestedBy: string;
    requestedAmount: number;
  }) {
    const [request] = await db
      .insert(budgetRequests)
      .values({ ...input, requestedAmount: String(input.requestedAmount), status: 'pending' })
      .returning();
    return request;
  },
  async listPendingBudgetRequests(orgId: string) {
    return db
      .select()
      .from(budgetRequests)
      .where(and(eq(budgetRequests.orgId, orgId), eq(budgetRequests.status, 'pending')));
  },
  async findBudgetRequest(requestId: string) {
    const [request] = await db
      .select()
      .from(budgetRequests)
      .where(eq(budgetRequests.id, requestId))
      .limit(1);
    return request ?? null;
  },
  async updateBudgetRequestStatus(
    requestId: string,
    status: 'approved' | 'rejected',
    approvedBy: string
  ) {
    const [request] = await db
      .update(budgetRequests)
      .set({ status, approvedBy })
      .where(eq(budgetRequests.id, requestId))
      .returning();
    return request ?? null;
  },
};

import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { db } from '../../config/database';
import { agents } from '../agents/agents.schema.db';
import { budgetRequests, budgets } from './budgets.schema.db';

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
const budgetFields = { id: budgets.id, orgId: budgets.orgId, scope: budgets.scope, scopeId: budgets.scopeId, limitAmount: budgets.limitAmount, period: budgets.period, resetTimezone: budgets.resetTimezone };

function toBudget(row: typeof budgetFields extends never ? never : { id: string; orgId: string; scope: BudgetScope; scopeId: string; limitAmount: string; period: 'daily' | 'monthly'; resetTimezone: string }): BudgetRecord {
  return { ...row, limitAmount: Number(row.limitAmount) };
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
    const [budget] = await db.select(budgetFields).from(budgets).where(eq(budgets.id, budgetId)).limit(1);
    return budget ? toBudget(budget as never) : null;
  },

  async findByScope(scope: BudgetScope, scopeId: string): Promise<BudgetRecord | null> {
    const [budget] = await db.select(budgetFields).from(budgets).where(and(eq(budgets.scope, scope), eq(budgets.scopeId, scopeId))).limit(1);
    return budget ? toBudget(budget as never) : null;
  },

  async createBudget(input: { orgId: string; scope: BudgetScope; scopeId: string; limitAmount: number; period: 'daily' | 'monthly'; resetTimezone: string }): Promise<BudgetRecord> {
    const [budget] = await db.insert(budgets).values({ ...input, limitAmount: String(input.limitAmount) }).returning(budgetFields);
    return toBudget(budget as never);
  },

  async updateBudget(budgetId: string, limitAmount: number): Promise<BudgetRecord | null> {
    const [budget] = await db.update(budgets).set({ limitAmount: String(limitAmount), updatedAt: new Date() }).where(eq(budgets.id, budgetId)).returning(budgetFields);
    return budget ? toBudget(budget as never) : null;
  },

  async listByScopes(orgId: string, scopes: Array<{ scope: BudgetScope; scopeIds: string[] }>): Promise<BudgetRecord[]> {
    const results = await Promise.all(scopes.filter((entry) => entry.scopeIds.length).map(async (entry) => {
      const rows = await db.select(budgetFields).from(budgets).where(and(eq(budgets.orgId, orgId), eq(budgets.scope, entry.scope), inArray(budgets.scopeId, entry.scopeIds)));
      return rows.map((row) => toBudget(row as never));
    }));
    return results.flat();
  },
  async listByOrganization(orgId: string): Promise<BudgetRecord[]> {
    const rows = await db.select(budgetFields).from(budgets).where(eq(budgets.orgId, orgId));
    return rows.map((row) => toBudget(row as never));
  },

  async sumAgentBudgetsForTeam(teamId: string, excludeBudgetId?: string): Promise<number> {
    const conditions = [eq(agents.teamId, teamId), eq(budgets.scope, 'agent')];
    if (excludeBudgetId) conditions.push(ne(budgets.id, excludeBudgetId));
    const [result] = await db.select({ total: sql<string>`coalesce(sum(${budgets.limitAmount}), 0)` }).from(budgets).innerJoin(agents, eq(budgets.scopeId, agents.id)).where(and(...conditions));
    return Number(result?.total ?? 0);
  },

  async createBudgetRequest(input: { orgId: string; budgetId: string; requestedBy: string; requestedAmount: number }) {
    const [request] = await db.insert(budgetRequests).values({ ...input, requestedAmount: String(input.requestedAmount), status: 'pending' }).returning();
    return request;
  },
  async listPendingBudgetRequests(orgId: string) {
    return db.select().from(budgetRequests).where(and(eq(budgetRequests.orgId, orgId), eq(budgetRequests.status, 'pending')));
  },
  async findBudgetRequest(requestId: string) {
    const [request] = await db.select().from(budgetRequests).where(eq(budgetRequests.id, requestId)).limit(1);
    return request ?? null;
  },
  async updateBudgetRequestStatus(requestId: string, status: 'approved' | 'rejected', approvedBy: string) {
    const [request] = await db.update(budgetRequests).set({ status, approvedBy }).where(eq(budgetRequests.id, requestId)).returning();
    return request ?? null;
  },
};

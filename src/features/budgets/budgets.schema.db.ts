import {
  check,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
export const budgetScopeEnum = pgEnum('budget_scope', ['org', 'team', 'agent']);
export const budgetPeriodEnum = pgEnum('budget_period', ['daily', 'monthly']);
const requestStatusEnum = pgEnum('request_status', ['pending', 'approved', 'rejected']);
const ts = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
const money = (n: string) => numeric(n, { precision: 12, scale: 4 }).notNull();
export const budgets = pgTable(
  'budgets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id').notNull(),
    scope: budgetScopeEnum('scope').notNull(),
    scopeId: uuid('scope_id').notNull(),
    limitAmount: money('limit_amount'),
    currency: text('currency').default('USD').notNull(),
    period: budgetPeriodEnum('period').notNull(),
    resetTimezone: text('reset_timezone').notNull(),
    ...ts(),
  },
  (t) => ({
    idxBudgetsScopeScopeId: index('idx_budgets_scope_scope_id').on(t.scope, t.scopeId),
    uqBudgetsScopeScopeId: uniqueIndex('uq_budgets_scope_scope_id').on(t.scope, t.scopeId),
    chkBudgetsLimitAmountPositive: check(
      'chk_budgets_limit_amount_positive',
      sql`${t.limitAmount} > 0`
    ),
  })
);
export const budgetRequests = pgTable('budget_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull(),
  budgetId: uuid('budget_id').notNull(),
  requestedBy: uuid('requested_by').notNull(),
  requestedAmount: money('requested_amount'),
  status: requestStatusEnum('status').default('pending').notNull(),
  approvedBy: uuid('approved_by'),
  ...ts(),
});

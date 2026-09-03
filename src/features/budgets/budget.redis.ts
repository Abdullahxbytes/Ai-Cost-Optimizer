import { Budget, BudgetScope } from './budgets.repository';

// Shared by proxy budget enforcement and alert scanning so both address the identical period counter.
export function getBudgetPeriodKey(
  period: Budget['period'],
  timezone: string,
  date = new Date()
): string {
  const values = new Map(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );
  const year = values.get('year');
  const month = values.get('month');
  const day = values.get('day');
  if (!year || !month || !day) throw new Error(`Unable to calculate budget period for ${timezone}`);
  return period === 'monthly' ? `${year}-${month}` : `${year}-${month}-${day}`;
}

export function getBudgetSpendKey(scope: BudgetScope, scopeId: string, budget: Budget): string {
  return `budget:spend:${scope}:${scopeId}:${getBudgetPeriodKey(budget.period, budget.resetTimezone)}`;
}

export function getBudgetCounterTtlSeconds(period: Budget['period']): number {
  return period === 'monthly' ? 32 * 24 * 60 * 60 : 25 * 60 * 60;
}

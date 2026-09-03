import type { Budget } from '../types/resources';

function formatBudgetAmount(amount: number) {
  return amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 5,
  });
}
type BudgetCardsProps = {
  budgets: Budget[];
  embedded?: boolean;
  onEdit?: (budget: Budget) => void;
  onDelete?: (budget: Budget) => void;
};

export function BudgetCards({ budgets, embedded = false, onEdit, onDelete }: BudgetCardsProps) {
  return budgets.length ? (
    <div className={embedded ? 'space-y-4' : 'grid gap-4 md:grid-cols-2 xl:grid-cols-3'}>
      {budgets.map((budget) => (
        <article
          key={budget.id}
          className={
            embedded
              ? 'border-b border-slate-800 pb-4 last:border-b-0 last:pb-0'
              : 'rounded-2xl border border-slate-800 bg-slate-900 p-5'
          }
        >
          <div className={embedded ? 'space-y-1' : 'flex items-start justify-between gap-3'}>
            <p className="capitalize text-cyan-400">{budget.scopeName ?? `${budget.scope} budget`}</p>
            <div className="flex items-center gap-2">
              <p className="text-sm text-slate-400">{budget.period}</p>
              {(onEdit || onDelete) && (
                <div className="flex gap-2">
                  {onEdit && <button type="button" onClick={() => onEdit(budget)} className="rounded border border-slate-600 px-2 py-1 text-xs">Edit</button>}
                  {onDelete && <button type="button" onClick={() => onDelete(budget)} className="rounded border border-red-400 px-2 py-1 text-xs text-red-300">Delete</button>}
                </div>
              )}
            </div>
          </div>
          {embedded ? (
            <div className="mt-4 space-y-1">
              <p className="text-2xl font-semibold">${formatBudgetAmount(budget.currentSpend)}</p>
              <p className="text-base text-slate-400">/ ${formatBudgetAmount(budget.limitAmount)}</p>
            </div>
          ) : (
            <p className="mt-4 text-2xl font-semibold">
              ${formatBudgetAmount(budget.currentSpend)}{' '}
              <span className="text-base font-normal text-slate-400">/ ${formatBudgetAmount(budget.limitAmount)}</span>
            </p>
          )}
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800">
            <div className="h-full bg-cyan-400" style={{ width: `${Math.min(budget.percentUsed, 100)}%` }} />
          </div>
          <p className="mt-2 text-sm text-slate-400">{budget.percentUsed.toFixed(1)}% used</p>
        </article>
      ))}
    </div>
  ) : (
    <p className="text-sm text-slate-400">No budgets are configured in this scope.</p>
  );
}

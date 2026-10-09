import type { Budget } from '../types/resources';
import { formatCurrency, formatPercentage } from '../lib/formatters';
type BudgetCardsProps = {
  budgets: Budget[];
  embedded?: boolean;
  onEdit?: (budget: Budget) => void;
  onDelete?: (budget: Budget) => void;
};

function progressTone(percentUsed: number) {
  if (percentUsed >= 100) return 'danger';
  if (percentUsed >= 80) return 'warning';
  return 'neutral';
}

export function BudgetCards({ budgets, embedded = false, onEdit, onDelete }: BudgetCardsProps) {
  return budgets.length ? (
    <div className={embedded ? 'space-y-4' : 'grid gap-4 md:grid-cols-2 xl:grid-cols-3'}>
      {budgets.map((budget) => (
        <article
          key={budget.id}
          className={
            embedded
              ? 'budget-card budget-card-embedded border-b border-slate-800 pb-4 last:border-b-0 last:pb-0'
              : 'budget-card rounded-2xl border border-slate-800 bg-slate-900 p-5'
          }
        >
          <div className={embedded ? 'space-y-1' : 'flex items-start justify-between gap-3'}>
            <p className="budget-card-name capitalize text-cyan-400">
              {budget.scopeName ?? `${budget.scope} budget`}
            </p>
            <div className="flex items-center gap-2">
              <p className="budget-card-period text-sm text-slate-400">{budget.period}</p>
              {(onEdit || onDelete) && (
                <div className="flex gap-2">
                  {onEdit && (
                    <button
                      type="button"
                      onClick={() => onEdit(budget)}
                      className="rounded border border-slate-600 px-2 py-1 text-xs"
                    >
                      Edit
                    </button>
                  )}
                  {onDelete && (
                    <button
                      type="button"
                      onClick={() => onDelete(budget)}
                      className="rounded border border-red-400 px-2 py-1 text-xs text-red-300"
                    >
                      Delete
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
          {embedded ? (
            <div className="mt-4 space-y-1">
              <p className="budget-card-amount text-2xl font-semibold">
                {formatCurrency(budget.currentSpend)}
              </p>
              <p className="text-base text-slate-400">/ {formatCurrency(budget.limitAmount)}</p>
            </div>
          ) : (
            <p className="mt-4 text-2xl font-semibold">
              {formatCurrency(budget.currentSpend)}{' '}
              <span className="text-base font-normal text-slate-400">
                / {formatCurrency(budget.limitAmount)}
              </span>
            </p>
          )}
          <div
            className="budget-progress mt-4 h-2 overflow-hidden rounded-full bg-slate-800"
            role="progressbar"
            aria-label={`${budget.scopeName ?? budget.scope} budget used`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(budget.percentUsed, 100)}
          >
            <div
              className={`budget-progress-fill budget-progress-fill-${progressTone(budget.percentUsed)} h-full`}
              style={{ width: `${Math.min(budget.percentUsed, 100)}%` }}
            />
          </div>
          <p className="mt-2 text-sm text-slate-400">{formatPercentage(budget.percentUsed)} used</p>
        </article>
      ))}
    </div>
  ) : (
    <p className="text-sm text-slate-400">No budgets are configured in this scope.</p>
  );
}

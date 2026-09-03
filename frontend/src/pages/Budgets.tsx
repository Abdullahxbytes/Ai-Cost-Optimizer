import axios from 'axios';
import { type FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { BudgetCards } from '../components/BudgetCards';
import { useAuthStore } from '../store/authStore';
import type { Agent, Budget, Team } from '../types/resources';

const errorMessage = (error: unknown) =>
  axios.isAxiosError(error) ? (error.response?.data?.error ?? 'Request failed') : 'Request failed';
export function Budgets({ requestOnly = false }: { requestOnly?: boolean }) {
  const user = useAuthStore((state) => state.user)!;
  const queryClient = useQueryClient();
  const allowedScopes =
    user.role === 'org_admin' ? (['org', 'team', 'agent'] as const) : (['team', 'agent'] as const);
  const [scope, setScope] = useState<(typeof allowedScopes)[number]>(allowedScopes[0]);
  const [scopeId, setScopeId] = useState(user.orgId ?? '');
  const [limitAmount, setLimitAmount] = useState('');
  const [period, setPeriod] = useState<'daily' | 'monthly'>('monthly');
  const [budgetId, setBudgetId] = useState('');
  const [requestedAmount, setRequestedAmount] = useState('');
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);
  const [editingLimit, setEditingLimit] = useState('');
  const budgets = useQuery({
    queryKey: ['budgets'],
    queryFn: async () => (await api.get<Budget[]>('/budgets')).data,
  });
  const teams = useQuery({
    queryKey: ['teams'],
    queryFn: async () => (await api.get<Team[]>('/teams')).data,
    enabled: !requestOnly,
  });
  const agents = useQuery({
    queryKey: ['agents'],
    queryFn: async () => (await api.get<Agent[]>('/agents')).data,
    enabled: !requestOnly,
  });
  useEffect(() => {
    if (scope === 'org') setScopeId(user.orgId ?? '');
    else if (scope === 'team') setScopeId(teams.data?.[0]?.id ?? '');
    else setScopeId(agents.data?.[0]?.id ?? '');
  }, [scope, user.orgId, teams.data, agents.data]);
  const create = useMutation({
    mutationFn: async () =>
      api.post('/budgets', { scope, scopeId, limitAmount: Number(limitAmount), period }),
    onSuccess: () => {
      setLimitAmount('');
      queryClient.invalidateQueries({ queryKey: ['budgets'] });
    },
  });
  const request = useMutation({
    mutationFn: async () =>
      api.post(`/budgets/${budgetId}/increase-requests`, {
        requestedAmount: Number(requestedAmount),
      }),
    onSuccess: () => {
      setRequestedAmount('');
      queryClient.invalidateQueries({ queryKey: ['budgets'] });
    },
  });
  const update = useMutation({
    mutationFn: async () => api.patch(`/budgets/${editingBudget!.id}`, { limitAmount: Number(editingLimit) }),
    onSuccess: () => {
      setEditingBudget(null);
      setEditingLimit('');
      queryClient.invalidateQueries({ queryKey: ['budgets'] });
    },
  });
  const remove = useMutation({
    mutationFn: async (budgetId: string) => api.delete(`/budgets/${budgetId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['budgets'] }),
  });
  const targets =
    scope === 'org'
      ? [{ id: user.orgId ?? '', label: 'Organization' }]
      : scope === 'team'
        ? (teams.data ?? []).map((team) => ({ id: team.id, label: team.name }))
        : (agents.data ?? []).map((agent) => ({ id: agent.id, label: agent.name }));
  function createBudget(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }
  function requestIncrease(event: FormEvent) {
    event.preventDefault();
    request.mutate();
  }
  function beginEdit(budget: Budget) {
    setEditingBudget(budget);
    setEditingLimit(String(budget.limitAmount));
  }
  function saveEdit(event: FormEvent) {
    event.preventDefault();
    update.mutate();
  }
  function deleteBudget(budget: Budget) {
    if (window.confirm(`Delete the ${budget.scopeName ?? budget.scope} budget?`)) remove.mutate(budget.id);
  }
  return (
    <div className="space-y-8">
      <section>
        <h1 className="mt-1 text-3xl font-semibold">{requestOnly ? 'My Budget Requests' : 'Budgets'}</h1>
      </section>
      {!requestOnly && (
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-lg font-semibold">Create budget</h2>
          <form onSubmit={createBudget} className="mt-5 grid gap-4 md:grid-cols-4">
            <label className="text-sm">
              Scope
              <select
                value={scope}
                onChange={(event) => setScope(event.target.value as typeof scope)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
              >
                {allowedScopes.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Target
              <select
                value={scopeId}
                onChange={(event) => setScopeId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
              >
                {targets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Limit (USD)
              <input
                required
                min={period === 'daily' ? '0.00001' : '0.01'}
                step={period === 'daily' ? '0.00001' : '0.01'}
                type="number"
                value={limitAmount}
                onChange={(event) => setLimitAmount(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
              />
            </label>
            <label className="text-sm">
              Period
              <select
                value={period}
                onChange={(event) => setPeriod(event.target.value as 'daily' | 'monthly')}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
              >
                <option value="monthly">Monthly</option>
                <option value="daily">Daily</option>
              </select>
            </label>
            <button
              disabled={create.isPending || !scopeId}
              className="rounded-lg bg-cyan-500 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50"
            >
              Create budget
            </button>
          </form>
          {create.isError && <p className="mt-3 text-sm text-red-300">{errorMessage(create.error)}</p>}
        </section>
      )}
      {(user.role === 'developer' || user.role === 'team_lead' || requestOnly) && (
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-lg font-semibold">Request budget increase</h2>
          <form onSubmit={requestIncrease} className="mt-5 flex flex-wrap gap-4">
            <select
              required
              value={budgetId}
              onChange={(event) => setBudgetId(event.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            >
              <option value="">Select budget</option>
              {budgets.data?.map((budget) => (
                <option key={budget.id} value={budget.id}>
                  {budget.scopeName ?? budget.scope} — ${budget.limitAmount}
                </option>
              ))}
            </select>
            <input
              required
              min="0.01"
              step="0.01"
              type="number"
              placeholder="Requested amount"
              value={requestedAmount}
              onChange={(event) => setRequestedAmount(event.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            />
            <button
              disabled={request.isPending || !budgetId}
              className="rounded-lg border border-cyan-400 px-4 py-2 text-cyan-300 disabled:opacity-50"
            >
              Submit request
            </button>
          </form>
          {request.isError && <p className="mt-3 text-sm text-red-300">{errorMessage(request.error)}</p>}
        </section>
      )}
      <section>
        <h2 className="text-lg font-semibold">Current budgets</h2>
        {editingBudget && (
          <form onSubmit={saveEdit} className="mt-4 flex flex-wrap items-end gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <label className="text-sm">
              New limit (USD)
              <input
                required
                min={editingBudget.period === 'daily' ? '0.00001' : '0.01'}
                step={editingBudget.period === 'daily' ? '0.00001' : '0.01'}
                type="number"
                value={editingLimit}
                onChange={(event) => setEditingLimit(event.target.value)}
                className="mt-1 block rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
              />
            </label>
            <button disabled={update.isPending} className="rounded-lg bg-cyan-500 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50">Save changes</button>
            <button type="button" onClick={() => setEditingBudget(null)} className="rounded-lg border border-slate-600 px-4 py-2">Cancel</button>
            {update.isError && <p className="text-sm text-red-300">{errorMessage(update.error)}</p>}
          </form>
        )}
        <div className="mt-4">
          {budgets.isLoading ? (
            <p className="text-sm text-slate-400">Loading budgets…</p>
          ) : (
            <BudgetCards
              budgets={budgets.data ?? []}
              onEdit={user.role === 'org_admin' ? beginEdit : undefined}
              onDelete={user.role === 'org_admin' ? deleteBudget : undefined}
            />
          )}
        </div>
      </section>
    </div>
  );
}

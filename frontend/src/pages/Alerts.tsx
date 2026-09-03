import axios from 'axios';
import { type FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuthStore } from '../store/authStore';
import type { Agent, AlertDefinition, AlertHistory, Team } from '../types/resources';

const errorMessage = (error: unknown) =>
  axios.isAxiosError(error) ? (error.response?.data?.error ?? 'Request failed') : 'Request failed';
const dateTime = (value: string | null) => (value ? new Date(value).toLocaleString() : '-');

export function Alerts() {
  const user = useAuthStore((state) => state.user)!;
  const queryClient = useQueryClient();
  const allowedScopes =
    user.role === 'org_admin' ? (['org', 'team', 'agent'] as const) : (['team', 'agent'] as const);
  const [scope, setScope] = useState<(typeof allowedScopes)[number]>(allowedScopes[0]);
  const [scopeId, setScopeId] = useState(user.orgId ?? '');
  const [type, setType] = useState<AlertDefinition['type']>('budget');
  const [thresholdPercent, setThresholdPercent] = useState('80');
  const [historyStatus, setHistoryStatus] = useState('');
  const alerts = useQuery({
    queryKey: ['alerts'],
    queryFn: async () => (await api.get<AlertDefinition[]>('/alerts')).data,
  });
  const history = useQuery({
    queryKey: ['alert-history', historyStatus],
    queryFn: async () =>
      (
        await api.get<AlertHistory[]>('/alert-history', {
          params: historyStatus ? { status: historyStatus } : {},
        })
      ).data,
  });
  const teams = useQuery({
    queryKey: ['teams'],
    queryFn: async () => (await api.get<Team[]>('/teams')).data,
  });
  const agents = useQuery({
    queryKey: ['agents'],
    queryFn: async () => (await api.get<Agent[]>('/agents')).data,
  });
  useEffect(() => {
    if (scope === 'org') setScopeId(user.orgId ?? '');
    else if (scope === 'team') setScopeId(teams.data?.[0]?.id ?? '');
    else setScopeId(agents.data?.[0]?.id ?? '');
  }, [scope, user.orgId, teams.data, agents.data]);
  const create = useMutation({
    mutationFn: async () =>
      api.post('/alerts', { type, scope, scopeId, thresholdPercent: Number(thresholdPercent) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alerts'] }),
  });
  const update = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) =>
      api.patch(`/alerts/${id}`, { active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alerts'] }),
  });
  const acknowledge = useMutation({
    mutationFn: async (id: string) => api.post(`/alert-history/${id}/acknowledge`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alert-history'] }),
  });
  const targets =
    scope === 'org'
      ? [{ id: user.orgId ?? '', label: 'Organization' }]
      : scope === 'team'
        ? (teams.data ?? []).map((item) => ({ id: item.id, label: item.name }))
        : (agents.data ?? []).map((item) => ({ id: item.id, label: item.name }));
  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }
  return (
    <div className="space-y-8">
      <section>
        <h1 className="mt-1 text-3xl font-semibold">Alerts</h1>
      </section>
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-lg font-semibold">Create alert</h2>
        <p className="mt-1 text-sm text-amber-300">
          Only budget alerts currently trigger. Spike and runaway definitions are stored for future detection.
        </p>
        <form onSubmit={submit} className="mt-5 grid gap-4 md:grid-cols-5">
          <label className="text-sm">
            Type
            <select
              value={type}
              onChange={(event) => setType(event.target.value as AlertDefinition['type'])}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            >
              <option value="budget">Budget</option>
              <option value="spike">Spike</option>
              <option value="runaway">Runaway</option>
            </select>
          </label>
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
              {targets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Threshold (%)
            <input
              required
              min="1"
              max="100"
              type="number"
              value={thresholdPercent}
              onChange={(event) => setThresholdPercent(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            />
          </label>
          <div className="self-end">
            <button
              disabled={create.isPending || !scopeId}
              className="rounded-lg bg-cyan-500 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50"
            >
              Create alert
            </button>
          </div>
        </form>
        {create.isError && <p className="mt-3 text-sm text-red-300">{errorMessage(create.error)}</p>}
      </section>
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-lg font-semibold">Alert definitions</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-800 text-slate-400">
              <tr>
                <th className="p-2">Type</th>
                <th className="p-2">Scope</th>
                <th className="p-2">Threshold</th>
                <th className="p-2">State</th>
              </tr>
            </thead>
            <tbody>
              {alerts.data?.map((alert) => (
                <tr key={alert.id} className="border-b border-slate-800/70">
                  <td className="p-2 capitalize">{alert.type}</td>
                  <td className="p-2 capitalize">
                    {alert.teamId ? 'team' : alert.agentId ? 'agent' : 'org'}
                  </td>
                  <td className="p-2">{alert.thresholdPercent}%</td>
                  <td className="p-2">
                    <button
                      disabled={update.isPending}
                      onClick={() => update.mutate({ id: alert.id, active: !alert.active })}
                      className={`rounded-md border px-3 py-1 text-xs ${alert.active ? 'border-emerald-500/60 text-emerald-300' : 'border-slate-700 text-slate-400'}`}
                    >
                      {alert.active ? 'Active - disable' : 'Inactive - enable'}
                    </button>
                  </td>
                </tr>
              ))}
              {!alerts.isLoading && !alerts.data?.length && (
                <tr>
                  <td className="p-2 text-slate-400" colSpan={4}>
                    No alerts are visible in this scope.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {update.isError && <p className="mt-3 text-sm text-red-300">{errorMessage(update.error)}</p>}
      </section>
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Alert history</h2>
          <div className="flex flex-wrap gap-2">
            {[
              ['', 'All'],
              ['triggered', 'Triggered'],
              ['acknowledged', 'Acknowledged'],
              ['resolved', 'Resolved'],
            ].map(([value, label]) => (
              <button
                key={value}
                onClick={() => setHistoryStatus(value)}
                className={`rounded-full px-3 py-1.5 text-xs font-bold ${historyStatus === value ? 'bg-cyan-500 text-slate-950' : 'border border-slate-700'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-800 text-slate-400">
              <tr>
                <th className="p-2">Alert</th>
                <th className="p-2">Threshold</th>
                <th className="p-2">Triggered</th>
                <th className="p-2">Status</th>
                <th className="p-2">Acknowledgment</th>
                <th className="p-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {history.data?.map((item) => (
                <tr key={item.id} className="border-b border-slate-800/70">
                  <td className="p-2 capitalize">
                    {item.alertType} - {item.scopeName ?? 'Organization'}
                  </td>
                  <td className="p-2">{item.thresholdPercent}%</td>
                  <td className="p-2">{dateTime(item.triggeredAt)}</td>
                  <td className="p-2">
                    <span className={`status-pill status-${item.status}`}>{item.status}</span>
                  </td>
                  <td className="p-2">
                    {item.acknowledgedByEmail ?? (item.acknowledgedAt ? dateTime(item.acknowledgedAt) : '-')}
                  </td>
                  <td className="p-2">
                    {item.status === 'triggered' ? (
                      <button
                        disabled={acknowledge.isPending}
                        onClick={() => acknowledge.mutate(item.id)}
                        className="rounded-md border border-cyan-400 px-3 py-1 text-xs text-cyan-300"
                      >
                        Acknowledge
                      </button>
                    ) : (
                      '-'
                    )}
                  </td>
                </tr>
              ))}
              {!history.isLoading && !history.data?.length && (
                <tr>
                  <td className="p-2 text-slate-400" colSpan={6}>
                    No alert history found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {acknowledge.isError && (
          <p className="mt-3 text-sm text-red-300">{errorMessage(acknowledge.error)}</p>
        )}
      </section>
    </div>
  );
}

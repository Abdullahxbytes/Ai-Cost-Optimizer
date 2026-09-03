import { useQuery } from '@tanstack/react-query';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api/client';
import { AgentTable } from '../components/AgentTable';
import { BudgetCards } from '../components/BudgetCards';
import { useAuthStore } from '../store/authStore';
import type { Agent, Budget, Team } from '../types/resources';

type TrendPoint = { period: string; totalCost: number; callCount: number };

function formatCost(amount: number) {
  return amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 5,
  });
}

export function Dashboard() {
  const user = useAuthStore((state) => state.user)!;
  const teams = useQuery({
    queryKey: ['teams', user.id],
    queryFn: async () => (await api.get<Team[]>('/teams')).data,
    enabled: user.role === 'team_lead',
  });
  const teamIds = teams.data?.map((team) => team.id) ?? [];
  const trend = useQuery({
    queryKey: ['cost-trend', user.role, teamIds],
    enabled: user.role === 'org_admin' || (user.role === 'team_lead' && teams.isSuccess),
    queryFn: async (): Promise<TrendPoint[]> => {
      const urls =
        user.role === 'org_admin'
          ? ['/analytics/costs/by-time?bucket=daily']
          : teamIds.map((id) => `/analytics/costs/by-time?bucket=daily&scope=team&scopeId=${id}`);
      const series = await Promise.all(urls.map(async (url) => (await api.get<TrendPoint[]>(url)).data));
      const combined = new Map<string, TrendPoint>();
      for (const points of series)
        for (const point of points) {
          const current = combined.get(point.period) ?? {
            period: point.period,
            totalCost: 0,
            callCount: 0,
          };
          current.totalCost += Number(point.totalCost);
          current.callCount += Number(point.callCount);
          combined.set(point.period, current);
        }
      return [...combined.values()].sort((a, b) => a.period.localeCompare(b.period));
    },
  });
  const agents = useQuery({
    queryKey: ['agents'],
    queryFn: async () => (await api.get<Agent[]>('/agents')).data,
  });
  const budgets = useQuery({
    queryKey: ['budgets'],
    queryFn: async () => (await api.get<Budget[]>('/budgets')).data,
  });
  const totalCost = trend.data?.reduce((sum, point) => sum + Number(point.totalCost), 0) ?? 0;
  const totalCalls = trend.data?.reduce((sum, point) => sum + Number(point.callCount), 0) ?? 0;
  const activeAgents = agents.data?.filter((agent) => agent.status === 'active').length ?? 0;
  const averageBudgetUse = budgets.data?.length
    ? budgets.data.reduce((sum, budget) => sum + budget.percentUsed, 0) / budgets.data.length
    : 0;
  return (
    <div className="dashboard-grid space-y-8">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total cost" value={`$${formatCost(totalCost)}`} />
        <StatCard label="AI calls" value={String(totalCalls)} />
        <StatCard label="Active agents" value={String(activeAgents)} />
        <StatCard label="Budget utilization" value={`${averageBudgetUse.toFixed(0)}%`} />
      </section>
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-lg font-semibold">Cost trend</h2>
        {trend.isLoading && <p className="mt-6 text-sm text-slate-400">Loading cost trend…</p>}
        {trend.isError && <p className="mt-6 text-sm text-red-300">Unable to load cost trend.</p>}
        {trend.data &&
          (trend.data.some((point) => point.callCount > 0) ? (
            <div className="mt-5 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend.data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#847C74" />
                  <XAxis dataKey="period" tick={{ fill: '#595F61', fontSize: 12 }} />
                  <YAxis tick={{ fill: '#595F61', fontSize: 12 }} tickFormatter={(value) => `$${value}`} />
                  <Tooltip formatter={(value) => `$${Number(value).toFixed(4)}`} />
                  <Line type="monotone" dataKey="totalCost" stroke="#F27624" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="mt-6 text-sm text-slate-400">No cost activity in the last 30 days.</p>
          ))}
      </section>
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-lg font-semibold">Agents</h2>
        <div className="mt-5">
          {agents.isLoading ? (
            <p className="text-sm text-slate-400">Loading agents…</p>
          ) : (
            <AgentTable agents={agents.data ?? []} />
          )}
        </div>
      </section>
      <section className="dashboard-budget-overview rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-lg font-semibold">Budget overview</h2>
        <div className="mt-4">
          {budgets.isLoading ? (
            <p className="text-sm text-slate-400">Loading budgets…</p>
          ) : (
            <BudgetCards budgets={budgets.data ?? []} embedded />
          )}
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value, trend = '' }: { label: string; value: string; trend?: string }) {
  return (
    <article className="stat-card">
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      <p className="stat-trend">↗ {trend}</p>
    </article>
  );
}

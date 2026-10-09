import { useQuery } from '@tanstack/react-query';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api/client';
import { AgentTable } from '../components/AgentTable';
import { BudgetCards } from '../components/BudgetCards';
import { formatCurrency, formatInteger, formatPercentage } from '../lib/formatters';
import { useAuthStore } from '../store/authStore';
import type { Agent, Budget, Team } from '../types/resources';

type TrendPoint = { period: string; totalCost: number; callCount: number };

const formatTrendDate = (value: string) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(`${value}T00:00:00`));

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
    <div className="dashboard-page">
      <section className="dashboard-small-screen-notice" aria-labelledby="dashboard-screen-title">
        <p className="dashboard-small-screen-eyebrow">CostFlow workspace</p>
        <h2 id="dashboard-screen-title">Use a larger screen</h2>
        <p>
          The dashboard is available on screens at least 1024 pixels wide. Open CostFlow on a desktop or
          larger tablet to review charts, budgets, and agents.
        </p>
      </section>
      <div className="dashboard-grid space-y-8">
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Total cost" value={formatCurrency(totalCost)} />
          <StatCard label="AI calls" value={formatInteger(totalCalls)} />
          <StatCard label="Active agents" value={formatInteger(activeAgents)} />
          <StatCard label="Budget utilization" value={formatPercentage(averageBudgetUse)} />
        </section>
        <section className="dashboard-trend-panel rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <div className="dashboard-panel-header">
            <div>
              <h2 className="text-lg font-semibold">Cost trend</h2>
              <p>Daily spend for the last 30 days</p>
            </div>
          </div>
          {trend.isLoading && <p className="mt-6 text-sm text-slate-400">Loading cost trend…</p>}
          {trend.isError && <p className="mt-6 text-sm text-red-300">Unable to load cost trend.</p>}
          {trend.data &&
            (trend.data.some((point) => point.callCount > 0) ? (
              <div className="mt-5 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trend.data} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                    <CartesianGrid vertical={false} strokeDasharray="2 5" stroke="#E7DDC8" />
                    <XAxis
                      dataKey="period"
                      axisLine={false}
                      tickLine={false}
                      minTickGap={34}
                      tick={{ fill: '#706A61', fontSize: 11 }}
                      tickFormatter={formatTrendDate}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      width={62}
                      tick={{ fill: '#706A61', fontSize: 11 }}
                      tickFormatter={(value) => formatCurrency(Number(value), { maximumFractionDigits: 4 })}
                    />
                    <Tooltip
                      labelFormatter={(value) => formatTrendDate(String(value))}
                      formatter={(value) => [formatCurrency(Number(value)), 'Cost']}
                      contentStyle={{
                        border: '1px solid #E7DDC8',
                        borderRadius: '12px',
                        background: '#FFFDF7',
                        boxShadow: '0 14px 30px rgb(85 67 40 / 12%)',
                      }}
                      labelStyle={{ color: '#1F201D', fontWeight: 600 }}
                      itemStyle={{ color: '#B9470D' }}
                      cursor={{ stroke: '#D9CFBD', strokeDasharray: '3 4' }}
                    />
                    <Line
                      type="monotone"
                      dataKey="totalCost"
                      stroke="#D85B12"
                      strokeWidth={2.5}
                      activeDot={{ r: 4, fill: '#D85B12', stroke: '#FFFDF7', strokeWidth: 2 }}
                      dot={false}
                    />
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
          <div className="dashboard-panel-header">
            <div>
              <h2 className="text-lg font-semibold">Budget overview</h2>
              <p>Current spend by budget</p>
            </div>
          </div>
          <div className="dashboard-budget-list mt-4">
            {budgets.isLoading ? (
              <p className="text-sm text-slate-400">Loading budgets…</p>
            ) : (
              <BudgetCards budgets={budgets.data ?? []} embedded />
            )}
          </div>
        </section>
      </div>
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

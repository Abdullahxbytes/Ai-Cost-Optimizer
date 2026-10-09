import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../api/client';
import { useAuthStore } from '../store/authStore';
import { formatCurrency, formatInteger, formatPercentage } from '../lib/formatters';
import type { Team } from '../types/resources';

type CostGroup = { provider: string; model?: string; totalCost: number; callCount: number };
type TokenSummary = {
  totalInputTokens: number;
  totalOutputTokens: number;
  efficiencyRatio: number;
  totalCalls: number;
};
type Reduction = { totalCallsOptimized: number; avgTokenReductionPercent: number };
type CostSavings = {
  cacheSavingsUsd: number;
  promptOptimizationSavingsUsd: number;
  totalSavingsUsd: number;
  isEstimate: boolean;
};
type HitRate = { period: string; totalCalls: number; cacheHits: number; hitRate: number };
type Comparison = {
  disclaimer: string;
  comparisons: Array<{
    provider: string;
    model: string;
    actualCost: number;
    hypotheticalCost: number;
  }>;
};
type Simulation = {
  actualCost: number;
  actualProvider: string | null;
  simulatedCost: number;
  targetProvider: string;
  targetModel: string;
  difference: number;
  percentChange: number;
  disclaimer: string;
};
const money = (value: number) => formatCurrency(value);
const defaultFrom = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
const defaultTo = new Date().toISOString().slice(0, 10);
const formatChartDate = (value: string) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(`${value}T00:00:00`));
const shortenChartLabel = (value: string) => (value.length > 18 ? `${value.slice(0, 17)}…` : value);
const chartTooltipStyle = {
  border: '1px solid #E7DDC8',
  borderRadius: '12px',
  background: '#FFFDF7',
  boxShadow: '0 14px 30px rgb(85 67 40 / 12%)',
};
const chartAxisTick = { fill: '#706A61', fontSize: 11 };
const chartGrid = { vertical: false, strokeDasharray: '2 5', stroke: '#E7DDC8' };

export function Analytics() {
  const user = useAuthStore((state) => state.user)!;
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const teams = useQuery({
    queryKey: ['teams', 'analytics'],
    queryFn: async () => (await api.get<Team[]>('/teams')).data,
    enabled: user.role === 'team_lead',
  });
  const [teamId, setTeamId] = useState('');
  const activeTeamId = teamId || teams.data?.[0]?.id || '';
  const params = useMemo(
    () => ({
      from,
      to,
      ...(user.role === 'team_lead'
        ? { scope: 'team', scopeId: activeTeamId }
        : { scope: 'org', scopeId: user.orgId ?? '' }),
    }),
    [from, to, user.role, user.orgId, activeTeamId],
  );
  const enabled = user.role !== 'team_lead' || Boolean(activeTeamId);
  const providers = useQuery({
    queryKey: ['analytics', 'providers', params],
    enabled,
    queryFn: async () => (await api.get<CostGroup[]>('/analytics/costs/by-provider', { params })).data,
  });
  const models = useQuery({
    queryKey: ['analytics', 'models', params],
    enabled,
    queryFn: async () => (await api.get<CostGroup[]>('/analytics/costs/by-model', { params })).data,
  });
  const tokens = useQuery({
    queryKey: ['analytics', 'tokens', params],
    enabled,
    queryFn: async () => (await api.get<TokenSummary>('/analytics/tokens/summary', { params })).data,
  });
  const reduction = useQuery({
    queryKey: ['analytics', 'reduction', params],
    enabled,
    queryFn: async () =>
      (await api.get<Reduction>('/analytics/optimization/token-reduction', { params })).data,
  });
  const savings = useQuery({
    queryKey: ['analytics', 'savings', params],
    enabled,
    queryFn: async () =>
      (await api.get<CostSavings>('/analytics/optimization/cost-savings', { params })).data,
  });
  const hitRate = useQuery({
    queryKey: ['analytics', 'hit-rate', params],
    enabled,
    queryFn: async () =>
      (
        await api.get<HitRate[]>('/analytics/cache/hit-rate', {
          params: { ...params, bucket: 'daily' },
        })
      ).data,
  });
  const comparison = useQuery({
    queryKey: ['analytics', 'comparison', params],
    enabled,
    queryFn: async () => (await api.get<Comparison>('/analytics/providers/cost-comparison', { params })).data,
  });
  const targets = comparison.data?.comparisons ?? [];
  const [targetKey, setTargetKey] = useState('');
  const selectedTarget = targets.find((row) => `${row.provider}::${row.model}` === targetKey) ?? targets[0];
  const simulation = useQuery({
    queryKey: ['analytics', 'simulation', params, selectedTarget?.provider, selectedTarget?.model],
    enabled: enabled && user.role !== 'finance' && Boolean(selectedTarget),
    queryFn: async () =>
      (
        await api.get<Simulation>('/analytics/simulate/provider-switch', {
          params: {
            ...params,
            targetProvider: selectedTarget!.provider,
            targetModel: selectedTarget!.model,
          },
        })
      ).data,
  });
  return (
    <div className="space-y-8">
      <section className="flex flex-wrap gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <label className="text-sm">
          From
          <input
            type="date"
            value={from}
            max={to}
            onChange={(event) => setFrom(event.target.value)}
            className="mt-1 block rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
          />
        </label>
        <label className="text-sm">
          To
          <input
            type="date"
            value={to}
            min={from}
            max={defaultTo}
            onChange={(event) => setTo(event.target.value)}
            className="mt-1 block rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
          />
        </label>
        {user.role === 'team_lead' && (
          <label className="text-sm">
            Team
            <select
              value={activeTeamId}
              onChange={(event) => setTeamId(event.target.value)}
              className="mt-1 block rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            >
              {teams.data?.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>
      <section>
        <h2 className="text-xl font-semibold">Cost breakdown</h2>
        <div className="mt-4 grid gap-5 xl:grid-cols-2">
          <ChartCard
            title="Cost by provider"
            description="Spend grouped by provider"
            loading={providers.isLoading}
            empty={!providers.data?.length}
          >
            <BarChart data={providers.data}>
              <CartesianGrid {...chartGrid} />
              <XAxis dataKey="provider" axisLine={false} tickLine={false} tick={chartAxisTick} />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={chartAxisTick}
                width={64}
                tickFormatter={money}
              />
              <Tooltip
                formatter={(value) => [money(Number(value)), 'Cost']}
                contentStyle={chartTooltipStyle}
                labelStyle={{ color: '#1F201D', fontWeight: 600 }}
                itemStyle={{ color: '#B9470D' }}
                cursor={{ fill: 'rgb(216 91 18 / 6%)' }}
              />
              <Bar dataKey="totalCost" fill="#D85B12" radius={[5, 5, 0, 0]} />
            </BarChart>
          </ChartCard>
          <ChartCard
            title="Cost by model"
            description="Spend grouped by model"
            loading={models.isLoading}
            empty={!models.data?.length}
          >
            <BarChart
              data={(models.data ?? []).map((item) => ({
                ...item,
                label: `${item.provider}/${item.model}`,
              }))}
            >
              <CartesianGrid {...chartGrid} />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                minTickGap={30}
                tick={chartAxisTick}
                tickFormatter={shortenChartLabel}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={chartAxisTick}
                width={64}
                tickFormatter={money}
              />
              <Tooltip
                formatter={(value) => [money(Number(value)), 'Cost']}
                contentStyle={chartTooltipStyle}
                labelStyle={{ color: '#1F201D', fontWeight: 600 }}
                itemStyle={{ color: '#B9470D' }}
                cursor={{ fill: 'rgb(216 91 18 / 6%)' }}
              />
              <Bar dataKey="totalCost" fill="#D85B12" radius={[5, 5, 0, 0]} />
            </BarChart>
          </ChartCard>
        </div>
      </section>
      <section>
        <h2 className="text-xl font-semibold">Token efficiency and savings</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Stat
            label="Input tokens"
            value={tokens.data ? formatInteger(tokens.data.totalInputTokens) : '-'}
          />
          <Stat
            label="Output tokens"
            value={tokens.data ? formatInteger(tokens.data.totalOutputTokens) : '-'}
          />
          <Stat label="Efficiency ratio" value={tokens.data ? tokens.data.efficiencyRatio.toFixed(3) : '-'} />
          <Stat label="Optimized calls" value={String(reduction.data?.totalCallsOptimized ?? '-')} />
        </div>
        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <h3 className="font-semibold">Optimization impact</h3>
            <p className="mt-3 text-3xl font-semibold text-cyan-300">
              {reduction.data
                ? formatPercentage(reduction.data.avgTokenReductionPercent, { maximumFractionDigits: 2 })
                : '-'}
            </p>
            <p className="mt-1 text-sm text-slate-400">
              Average token reduction across calls where optimization reduced the prompt.
            </p>
            <div className="mt-5 grid grid-cols-3 gap-3 text-sm">
              <Saving label="Cache" value={money(savings.data?.cacheSavingsUsd ?? 0)} />
              <Saving label="Prompt" value={money(savings.data?.promptOptimizationSavingsUsd ?? 0)} />
              <Saving label="Combined" value={money(savings.data?.totalSavingsUsd ?? 0)} />
            </div>
            {savings.data?.isEstimate && (
              <p className="mt-3 text-xs text-amber-300">
                Estimated: cache savings are based on comparable non-cached usage; prompt savings use
                configured input-token pricing.
              </p>
            )}
          </div>
          <ChartCard
            title="Cache hit rate"
            description="Daily share of requests served from cache"
            loading={hitRate.isLoading}
            empty={!hitRate.data?.some((row) => row.totalCalls > 0)}
          >
            <LineChart data={hitRate.data}>
              <CartesianGrid {...chartGrid} />
              <XAxis
                dataKey="period"
                axisLine={false}
                tickLine={false}
                minTickGap={34}
                tick={chartAxisTick}
                tickFormatter={formatChartDate}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={chartAxisTick}
                width={52}
                tickFormatter={(value) => formatPercentage(Number(value), { maximumFractionDigits: 0 })}
              />
              <Tooltip
                labelFormatter={(value) => formatChartDate(String(value))}
                formatter={(value) => [
                  formatPercentage(Number(value), { maximumFractionDigits: 2 }),
                  'Hit rate',
                ]}
                contentStyle={chartTooltipStyle}
                labelStyle={{ color: '#1F201D', fontWeight: 600 }}
                itemStyle={{ color: '#B9470D' }}
                cursor={{ stroke: '#D9CFBD', strokeDasharray: '3 4' }}
              />
              <Line
                type="monotone"
                dataKey="hitRate"
                stroke="#D85B12"
                strokeWidth={2.5}
                activeDot={{ r: 4, fill: '#D85B12', stroke: '#FFFDF7', strokeWidth: 2 }}
                dot={false}
              />
            </LineChart>
          </ChartCard>
        </div>
      </section>
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-xl font-semibold">Provider comparison</h2>
        <p className="mt-2 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">
          {comparison.data?.disclaimer ?? 'Price-only comparison; it does not assess model capability.'}
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-800 text-slate-400">
              <tr>
                <th className="p-2">Provider</th>
                <th className="p-2">Model</th>
                <th className="p-2">Actual cost</th>
                <th className="p-2">Hypothetical cost</th>
              </tr>
            </thead>
            <tbody>
              {targets.map((row) => (
                <tr key={`${row.provider}-${row.model}`} className="border-b border-slate-800/70">
                  <td className="p-2">{row.provider}</td>
                  <td className="p-2">{row.model}</td>
                  <td className="p-2">{money(row.actualCost)}</td>
                  <td className="p-2">{money(row.hypotheticalCost)}</td>
                </tr>
              ))}
              {comparison.isLoading && (
                <tr>
                  <td className="p-2 text-slate-400" colSpan={4}>
                    Loading comparison...
                  </td>
                </tr>
              )}
              {!comparison.isLoading && !targets.length && (
                <tr>
                  <td className="p-2 text-slate-400" colSpan={4}>
                    No configured pricing or usage in this range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {user.role !== 'finance' && (
          <div className="mt-6 border-t border-slate-800 pt-5">
            <h3 className="font-semibold">Provider-switch simulation</h3>
            <label className="mt-3 block w-full max-w-md text-sm">
              Target provider and model
              <select
                value={
                  targetKey || (selectedTarget ? `${selectedTarget.provider}::${selectedTarget.model}` : '')
                }
                onChange={(event) => setTargetKey(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
              >
                {targets.map((row) => (
                  <option key={`${row.provider}-${row.model}`} value={`${row.provider}::${row.model}`}>
                    {row.provider} / {row.model}
                  </option>
                ))}
              </select>
            </label>
            {simulation.isLoading && <p className="mt-3 text-sm text-slate-400">Calculating scenario...</p>}
            {simulation.data && (
              <div className="mt-4 grid gap-3 sm:grid-cols-4">
                <Stat label="Actual cost" value={money(simulation.data.actualCost)} />
                <Stat label="Simulated cost" value={money(simulation.data.simulatedCost)} />
                <Stat label="Difference" value={money(simulation.data.difference)} />
                <Stat
                  label="Change"
                  value={formatPercentage(simulation.data.percentChange, { maximumFractionDigits: 2 })}
                />
              </div>
            )}
            {simulation.isError && (
              <p className="mt-3 text-sm text-red-300">No pricing is configured for this provider/model.</p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function ChartCard({
  title,
  description,
  loading,
  empty,
  children,
}: {
  title: string;
  description?: string;
  loading: boolean;
  empty: boolean;
  children: React.ReactElement;
}) {
  return (
    <div className="analytics-chart-card rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <div className="analytics-chart-header">
        <h3 className="font-semibold">{title}</h3>
        {description && <p>{description}</p>}
      </div>
      {loading ? (
        <p className="mt-6 text-sm text-slate-400">Loading...</p>
      ) : empty ? (
        <p className="mt-6 text-sm text-slate-400">No activity in this range.</p>
      ) : (
        <div className="mt-4 h-72">
          <ResponsiveContainer width="100%" height="100%">
            {children}
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="analytics-stat-card rounded-xl border border-slate-800 bg-slate-900 p-4">
      <p className="analytics-stat-label text-sm text-slate-400">{label}</p>
      <p className="analytics-stat-value mt-2 text-2xl">{value}</p>
    </div>
  );
}
function Saving({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-slate-400">{label}</p>
      <p className="mt-1 font-semibold text-cyan-300">{value}</p>
    </div>
  );
}

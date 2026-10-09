import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';

type Health = {
  postgres: 'healthy' | 'unhealthy';
  redis: 'healthy' | 'unhealthy';
  activeOrgs: number;
  activeAgents: number;
  timestamp: string;
};
type Endpoint = { route: string; averageResponseTimeMs: number; errorRate: number; requestCount: number };
type EndpointHealthResponse = { redis: 'healthy' | 'unhealthy'; routes: Endpoint[] };
export function Health() {
  const health = useQuery({
    queryKey: ['admin-health'],
    queryFn: async () => (await api.get<Health>('/admin/health')).data,
    refetchInterval: 30_000,
  });
  const endpoints = useQuery({
    queryKey: ['endpoint-health'],
    queryFn: async () => (await api.get<EndpointHealthResponse>('/admin/health/endpoints')).data,
    refetchInterval: 30_000,
  });
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">System Health</h1>
      <div className="grid gap-4 md:grid-cols-4">
        {[
          ['PostgreSQL', health.data?.postgres],
          ['Redis', health.data?.redis],
          ['Active organizations', health.data?.activeOrgs],
          ['Active agents', health.data?.activeAgents],
        ].map(([label, value]) => (
          <div
            key={String(label)}
            className="analytics-stat-card rounded-xl border border-slate-800 bg-slate-900 p-4"
          >
            <p className="analytics-stat-label text-sm text-slate-400">{label}</p>
            <p
              className={`analytics-stat-value mt-2 text-xl ${value === 'healthy' ? 'text-emerald-300' : value === 'unhealthy' ? 'text-red-300' : ''}`}
            >
              {value ?? 'Loading...'}
            </p>
          </div>
        ))}
      </div>
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-lg font-semibold">Endpoint health</h2>
        <table className="mt-4 w-full text-left text-sm">
          <thead className="text-slate-400">
            <tr>
              <th>Route</th>
              <th>Requests</th>
              <th>Avg. response</th>
              <th>Error rate</th>
            </tr>
          </thead>
          <tbody>
            {endpoints.data?.routes.map((item) => (
              <tr key={item.route} className="border-t border-slate-800">
                <td className="py-2">{item.route}</td>
                <td>{item.requestCount}</td>
                <td>{item.averageResponseTimeMs.toFixed(1)}ms</td>
                <td>{item.errorRate.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        {endpoints.isError && (
          <p className="mt-3 text-sm text-red-300">Endpoint health could not be loaded.</p>
        )}
      </section>
    </div>
  );
}

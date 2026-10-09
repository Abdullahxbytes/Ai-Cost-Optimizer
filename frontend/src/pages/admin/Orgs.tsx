import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
type Org = { id: string; name: string; timezone: string; status: 'active' | 'blocked' };
export function Orgs() {
  const client = useQueryClient();
  const [pending, setPending] = useState<Org | null>(null);
  const orgs = useQuery({
    queryKey: ['admin-orgs'],
    queryFn: async () => (await api.get<Org[]>('/orgs')).data,
  });
  const change = useMutation({
    mutationFn: async (org: Org) =>
      api.post(`/orgs/${org.id}/${org.status === 'active' ? 'block' : 'unblock'}`),
    onSuccess: () => {
      setPending(null);
      client.invalidateQueries({ queryKey: ['admin-orgs'] });
    },
  });
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">Organization Management</h1>
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <table className="w-full text-left text-sm">
          <thead className="text-slate-400">
            <tr>
              <th>Name</th>
              <th>Timezone</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {orgs.data?.map((org) => (
              <tr key={org.id} className="border-t border-slate-800">
                <td className="py-3">{org.name}</td>
                <td>{org.timezone}</td>
                <td>
                  <span
                    className={`status-pill ${org.status === 'active' ? 'status-active' : 'status-error'}`}
                  >
                    {org.status}
                  </span>
                </td>
                <td>
                  <button
                    onClick={() => setPending(org)}
                    className="rounded border border-slate-700 px-3 py-1"
                  >
                    {org.status === 'active' ? 'Block' : 'Unblock'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
          <section className="max-w-md rounded-xl bg-slate-900 p-6">
            <h2 className="text-xl font-semibold">
              {pending.status === 'active' ? 'Block organization?' : 'Unblock organization?'}
            </h2>
            <p className="mt-3 text-slate-300">
              {pending.status === 'active'
                ? 'Blocking immediately invalidates every active session in this organization.'
                : 'Users may sign in again, but their old sessions remain invalid.'}
            </p>
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => change.mutate(pending)}
                className="rounded bg-red-500 px-4 py-2 font-medium text-white"
              >
                Confirm
              </button>
              <button onClick={() => setPending(null)} className="rounded border border-slate-700 px-4 py-2">
                Cancel
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

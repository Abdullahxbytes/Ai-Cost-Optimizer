import axios from 'axios';
import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuthStore } from '../store/authStore';
type User = { id: string; email: string; role: string; active: boolean };
const roles = ['org_admin', 'finance', 'auditor', 'team_lead', 'developer'];
const message = (e: unknown) =>
  axios.isAxiosError(e) ? (e.response?.data?.error ?? 'Request failed') : 'Request failed';
export function Users() {
  const currentUser = useAuthStore((state) => state.user!);
  const orgId = currentUser.orgId!;
  const c = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('developer');
  const users = useQuery({
    queryKey: ['org-users'],
    queryFn: async () => (await api.get<User[]>(`/orgs/${orgId}/users`)).data,
  });
  const refresh = () => c.invalidateQueries({ queryKey: ['org-users'] });
  const invite = useMutation({
    mutationFn: () => api.post(`/orgs/${orgId}/users`, { email, role, initialPassword: password }),
    onSuccess: () => {
      setEmail('');
      setPassword('');
      refresh();
    },
  });
  const update = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) =>
      api.patch(`/orgs/${orgId}/users/${id}`, { role }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/orgs/${orgId}/users/${id}`),
    onSuccess: refresh,
  });
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">Users</h1>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          invite.mutate();
        }}
        className="flex flex-wrap gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-5"
      >
        <input
          required
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded border border-slate-700 bg-slate-950 px-3 py-2"
        />
        <input
          required
          minLength={8}
          type="password"
          placeholder="Initial password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded border border-slate-700 bg-slate-950 px-3 py-2"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="rounded border border-slate-700 bg-slate-950 px-3 py-2"
        >
          {roles.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <button className="rounded bg-cyan-500 px-4 py-2 font-semibold text-slate-950">Invite user</button>
      </form>
      {(invite.isError || update.isError || remove.isError) && (
        <p className="text-red-300">{message(invite.error ?? update.error ?? remove.error)}</p>
      )}
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        {users.data?.map((u) => (
          <div
            key={u.id}
            className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 py-3"
          >
            <span>
              {u.email} {!u.active && '(removed)'}
            </span>
            <div className="flex gap-2">
              {u.id === currentUser.id ? (
                <span className="status-pill status-active">{u.role.replace('_', ' ')}</span>
              ) : (
                <select
                  value={u.role}
                  onChange={(e) => update.mutate({ id: u.id, role: e.target.value })}
                  className="rounded border border-slate-700 bg-slate-950 px-2 py-1"
                >
                  {roles.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              )}
              {u.active && u.id !== currentUser.id && (
                <button
                  onClick={() => {
                    if (confirm(`Remove ${u.email}?`)) remove.mutate(u.id);
                  }}
                  className="rounded border border-red-500/60 px-3 py-1 text-red-300"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

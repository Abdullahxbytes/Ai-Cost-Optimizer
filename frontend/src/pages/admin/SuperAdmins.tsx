import axios from 'axios';
import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';

type SuperAdmin = { id: string; email: string; createdAt: string };
const errorMessage = (error: unknown) =>
  axios.isAxiosError(error) ? (error.response?.data?.error ?? 'Request failed') : 'Request failed';

export function SuperAdmins() {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const admins = useQuery({
    queryKey: ['super-admins'],
    queryFn: async () => (await api.get<SuperAdmin[]>('/super-admins')).data,
  });
  const add = useMutation({
    mutationFn: async () => api.post('/super-admins', { email, password }),
    onSuccess: () => {
      setEmail('');
      setPassword('');
      queryClient.invalidateQueries({ queryKey: ['super-admins'] });
    },
  });
  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/super-admins/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['super-admins'] }),
  });
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">Super Admin Management</h1>
      <form
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          add.mutate();
        }}
        className="flex flex-wrap gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-5"
      >
        <input
          required
          type="email"
          placeholder="Email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="rounded border border-slate-700 bg-slate-950 px-3 py-2"
        />
        <input
          required
          type="password"
          minLength={8}
          placeholder="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="rounded border border-slate-700 bg-slate-950 px-3 py-2"
        />
        <button className="rounded bg-cyan-500 px-4 py-2 font-semibold text-slate-950">
          Add Super Admin
        </button>
      </form>
      {(add.isError || remove.isError) && (
        <p className="text-red-300">{errorMessage(add.error ?? remove.error)}</p>
      )}
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        {admins.data?.map((admin) => (
          <div key={admin.id} className="flex items-center justify-between border-b border-slate-800 py-3">
            <span>{admin.email}</span>
            <button
              onClick={() => {
                if (window.confirm(`Remove ${admin.email}?`)) remove.mutate(admin.id);
              }}
              className="rounded border border-red-500/60 px-3 py-1 text-red-300"
            >
              Remove
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}

import axios from 'axios';
import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuthStore } from '../store/authStore';

type Provider = 'openai' | 'anthropic' | 'gemini';
type ProviderKey = {
  provider: Provider;
  keyLastFour: string;
  addedBy: string;
  createdAt: string;
  updatedAt: string;
};

function errorMessage(error: unknown) {
  if (!axios.isAxiosError(error)) return 'Request failed';
  if (error.response?.status === 429) {
    const seconds = Number(error.response.data?.retryAfter ?? 0);
    return seconds > 0
      ? `Too many attempts. Try again in ${Math.ceil(seconds / 60)} minute(s).`
      : 'Too many attempts. Try again shortly.';
  }
  return error.response?.data?.error ?? 'Request failed';
}

export function ProviderKeys() {
  const orgId = useAuthStore((state) => state.user?.orgId)!;
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState<Provider>('gemini');
  const [apiKey, setApiKey] = useState('');
  const keys = useQuery({
    queryKey: ['provider-keys', orgId],
    queryFn: async () => (await api.get<ProviderKey[]>(`/orgs/${orgId}/provider-keys`)).data,
  });
  const save = useMutation({
    mutationFn: () => api.post(`/orgs/${orgId}/provider-keys`, { provider, apiKey }),
    onSuccess: () => {
      setApiKey('');
      void queryClient.invalidateQueries({ queryKey: ['provider-keys', orgId] });
    },
  });
  const remove = useMutation({
    mutationFn: (value: Provider) => api.delete(`/orgs/${orgId}/provider-keys/${value}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['provider-keys', orgId] }),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <div className="space-y-7">
      <section>
        <h1 className="text-3xl font-semibold">Provider keys</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
          Your organization&apos;s AI provider keys are used directly for your agents&apos; requests. We never
          return or display the full key after it is saved; cost tracking uses the pricing you configure here.
        </p>
      </section>
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-lg font-semibold">Add or replace a provider key</h2>
        <form onSubmit={submit} className="mt-4 grid gap-4 md:grid-cols-[180px_1fr_auto]">
          <select
            value={provider}
            onChange={(event) => setProvider(event.target.value as Provider)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
          >
            <option value="gemini">Gemini</option>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
          </select>
          <input
            required
            type="password"
            autoComplete="off"
            placeholder="Provider API key"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
          />
          <button
            disabled={save.isPending}
            className="rounded-lg bg-cyan-500 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50"
          >
            {save.isPending ? 'Verifying…' : 'Save key'}
          </button>
        </form>
        {save.isError && <p className="mt-3 text-sm text-red-300">{errorMessage(save.error)}</p>}
      </section>
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-lg font-semibold">Configured providers</h2>
        {keys.isLoading ? (
          <p className="mt-4 text-sm text-slate-400">Loading keys…</p>
        ) : keys.data?.length ? (
          <div className="mt-4 divide-y divide-slate-800">
            {keys.data.map((key) => (
              <div key={key.provider} className="flex flex-wrap items-center justify-between gap-4 py-4">
                <div>
                  <p className="font-medium capitalize">
                    {key.provider}{' '}
                    <span className="font-mono text-sm text-slate-400">••••{key.keyLastFour}</span>
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Added by {key.addedBy} · updated {new Date(key.updatedAt).toLocaleString()}
                  </p>
                </div>
                <button
                  onClick={() => {
                    if (
                      confirm(
                        'Agents using this provider will be unable to make calls until a new key is added. Delete this key?',
                      )
                    )
                      remove.mutate(key.provider);
                  }}
                  disabled={remove.isPending}
                  className="rounded-lg border border-red-500/70 px-3 py-2 text-sm text-red-300 disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-400">No provider keys are configured.</p>
        )}
        {remove.isError && <p className="mt-3 text-sm text-red-300">{errorMessage(remove.error)}</p>}
      </section>
    </div>
  );
}

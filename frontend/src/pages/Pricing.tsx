import axios from 'axios';
import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuthStore } from '../store/authStore';

type Rate = {
  id: string;
  provider: string;
  model: string;
  inputPricePer1k: number;
  outputPricePer1k: number;
  effectiveDate: string;
};
const providers = ['openai', 'anthropic', 'gemini'];
const problem = (error: unknown) =>
  axios.isAxiosError(error) ? (error.response?.data?.error ?? 'Request failed') : 'Request failed';
const today = () => new Date().toISOString().slice(0, 10);

export function Pricing() {
  const orgId = useAuthStore((state) => state.user?.orgId)!;
  const client = useQueryClient();
  const [provider, setProvider] = useState('gemini');
  const [model, setModel] = useState('');
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(today());
  const [editing, setEditing] = useState<Rate | null>(null);
  const rates = useQuery({
    queryKey: ['pricing', orgId],
    queryFn: async () => (await api.get<Rate[]>(`/orgs/${orgId}/pricing`)).data,
  });
  const refresh = () => void client.invalidateQueries({ queryKey: ['pricing', orgId] });
  const create = useMutation({
    mutationFn: () =>
      api.post(`/orgs/${orgId}/pricing`, {
        provider,
        model,
        inputPricePer1k: Number(input),
        outputPricePer1k: Number(output),
        effectiveDate,
      }),
    onSuccess: () => {
      setModel('');
      setInput('');
      setOutput('');
      refresh();
    },
  });
  const update = useMutation({
    mutationFn: () =>
      api.patch(`/orgs/${orgId}/pricing/${editing!.id}`, {
        inputPricePer1k: Number(input),
        outputPricePer1k: Number(output),
        effectiveDate,
      }),
    onSuccess: () => {
      setEditing(null);
      setModel('');
      setInput('');
      setOutput('');
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (pricingId: string) => api.delete(`/orgs/${orgId}/pricing/${pricingId}`),
    onSuccess: (_, pricingId) => {
      if (editing?.id === pricingId) setEditing(null);
      refresh();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    editing ? update.mutate() : create.mutate();
  };
  const edit = (rate: Rate) => {
    setEditing(rate);
    setProvider(rate.provider);
    setModel(rate.model);
    setInput(String(rate.inputPricePer1k));
    setOutput(String(rate.outputPricePer1k));
    setEffectiveDate(rate.effectiveDate.slice(0, 10));
  };
  const error = create.error ?? update.error ?? remove.error;
  return (
    <div className="space-y-7">
      <section>
        <h1 className="text-3xl font-semibold">Pricing</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
          Enter your negotiated rates so cost tracking and analytics reflect your actual spend. Prices are USD
          per 1,000 tokens.
        </p>
      </section>
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-lg font-semibold">
          {editing ? `Edit ${editing.provider} / ${editing.model}` : 'Add organization rate'}
        </h2>
        <form onSubmit={submit} className="mt-4 grid gap-4 md:grid-cols-3">
          <label className="text-sm">
            Provider
            <select
              disabled={Boolean(editing)}
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 disabled:opacity-60"
            >
              {providers.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Model
            <input
              required
              disabled={Boolean(editing)}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 disabled:opacity-60"
            />
          </label>
          <label className="text-sm">
            Effective date
            <input
              required
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            />
          </label>
          <label className="text-sm">
            Input price / 1K
            <input
              required
              min="0"
              step="0.000001"
              type="number"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            />
          </label>
          <label className="text-sm">
            Output price / 1K
            <input
              required
              min="0"
              step="0.000001"
              type="number"
              value={output}
              onChange={(e) => setOutput(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            />
          </label>
          <div className="flex items-end gap-3">
            <button
              disabled={create.isPending || update.isPending}
              className="rounded-lg bg-cyan-500 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50"
            >
              {editing ? 'Save changes' : 'Add rate'}
            </button>
            {editing && (
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setModel('');
                  setInput('');
                  setOutput('');
                }}
                className="rounded-lg border border-slate-700 px-4 py-2"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
        {error && <p className="mt-3 text-sm text-red-300">{problem(error)}</p>}
      </section>
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-lg font-semibold">Your organization&apos;s rates</h2>
        {rates.isLoading ? (
          <p className="mt-4 text-sm text-slate-400">Loading pricing…</p>
        ) : rates.data?.length ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-700 text-slate-400">
                <tr>
                  <th className="p-2">Provider</th>
                  <th className="p-2">Model</th>
                  <th className="p-2">Input / 1K</th>
                  <th className="p-2">Output / 1K</th>
                  <th className="p-2">Effective</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {rates.data.map((rate) => (
                  <tr key={rate.id} className="border-b border-slate-800">
                    <td className="p-2 capitalize">{rate.provider}</td>
                    <td className="p-2">{rate.model}</td>
                    <td className="p-2">${rate.inputPricePer1k}</td>
                    <td className="p-2">${rate.outputPricePer1k}</td>
                    <td className="p-2">{new Date(rate.effectiveDate).toLocaleDateString()}</td>
                    <td className="p-2 text-right">
                      <button
                        onClick={() => edit(rate)}
                        className="rounded border border-slate-700 px-3 py-1 hover:bg-slate-800"
                      >
                        Edit
                      </button>
                      <button
                        disabled={remove.isPending}
                        onClick={() => {
                          if (window.confirm(`Delete the ${rate.provider} / ${rate.model} rate?`)) {
                            remove.mutate(rate.id);
                          }
                        }}
                        className="ml-2 rounded border border-red-500/60 px-3 py-1 text-red-600 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-400">
            No organization-specific rates yet. Global defaults remain available until you add one.
          </p>
        )}
      </section>
    </div>
  );
}

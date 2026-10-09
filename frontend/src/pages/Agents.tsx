import axios from 'axios';
import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { AgentTable } from '../components/AgentTable';
import { useAuthStore } from '../store/authStore';
import type { Agent, Team } from '../types/resources';

type PendingDeletion = { id: string; agentId: string; recipientUserId: string; requestedAt: string };
type OptimizationSettings = {
  promptOptimizationEnabled: boolean;
  semanticCacheEnabled: boolean;
  cacheSimilarityThreshold: number;
  cacheTtlSeconds: number;
  cacheRuntimeStatus?: 'active';
};
type CachePolicy = {
  mode: 'off' | 'exact' | 'exact_semantic';
  workload: string;
  storageAllowed: boolean;
  scope: 'shared' | 'end_user';
  risk: 'standard' | 'sensitive' | 'side_effecting';
  freshness: 'versioned' | 'live';
  allowConversationExact: boolean;
  semanticApproved: boolean;
  embeddingProvider?: 'gemini';
  ttlSeconds: number;
  similarityThreshold: number;
  knowledgeVersion: string;
  promptVersion: string;
  workloadVersion: string;
};
type CachePolicyResponse = {
  policy: CachePolicy;
  revision: number;
  configured: boolean;
  runtimeStatus: string;
};
type CacheDiagnostic = {
  createdAt: string;
  outcome: string;
  reason: string;
  provider: string;
  model: string | null;
  lookupLatencyMs: number;
  embeddingCostStatus: string;
};

const errorMessage = (error: unknown) =>
  axios.isAxiosError(error) ? (error.response?.data?.error ?? 'Request failed') : 'Request failed';
export function Agents() {
  const user = useAuthStore((state) => state.user)!;
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [teamId, setTeamId] = useState('');
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deletionTarget, setDeletionTarget] = useState<Agent | null>(null);
  const [settingsTarget, setSettingsTarget] = useState<Agent | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<OptimizationSettings | null>(null);
  const [cachePolicyDraft, setCachePolicyDraft] = useState<CachePolicy | null>(null);
  const agents = useQuery({
    queryKey: ['agents'],
    queryFn: async () => (await api.get<Agent[]>('/agents')).data,
  });
  const teams = useQuery({
    queryKey: ['teams'],
    queryFn: async () => (await api.get<Team[]>('/teams')).data,
    enabled: user.role === 'developer',
  });
  const registration = useMutation({
    mutationFn: async () => (await api.post<Agent & { apiKey: string }>('/agents', { name, teamId })).data,
    onSuccess: (agent) => {
      setApiKey(agent.apiKey);
      setCopied(false);
      setName('');
      setTeamId('');
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });
  const deletions = useQuery({
    queryKey: ['agent-deletions', 'mine'],
    queryFn: async () => (await api.get<PendingDeletion[]>('/agent-deletions')).data,
    enabled: user.role === 'org_admin' || user.role === 'team_lead',
  });
  const optimization = useQuery({
    queryKey: ['optimization-settings', settingsTarget?.id],
    queryFn: async () =>
      (await api.get<OptimizationSettings>(`/agents/${settingsTarget!.id}/optimization-settings`)).data,
    enabled: Boolean(settingsTarget),
  });
  const cachePolicy = useQuery({
    queryKey: ['cache-policy', settingsTarget?.id],
    queryFn: async () =>
      (await api.get<CachePolicyResponse>(`/agents/${settingsTarget!.id}/cache-policy`)).data,
    enabled: Boolean(settingsTarget),
  });
  const cacheDiagnostics = useQuery({
    queryKey: ['cache-diagnostics', settingsTarget?.id],
    queryFn: async () =>
      (await api.get<CacheDiagnostic[]>(`/agents/${settingsTarget!.id}/cache-diagnostics`)).data,
    enabled: Boolean(settingsTarget),
  });
  const saveCachePolicy = useMutation({
    mutationFn: () =>
      api.put(`/agents/${settingsTarget!.id}/cache-policy`, cachePolicyDraft ?? cachePolicy.data!.policy),
    onSuccess: () => {
      setCachePolicyDraft(null);
      void queryClient.invalidateQueries({ queryKey: ['cache-policy', settingsTarget?.id] });
    },
  });
  const purgeCache = useMutation({
    mutationFn: () => api.delete(`/agents/${settingsTarget!.id}/cache`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['cache-policy', settingsTarget?.id] }),
  });
  const saveOptimization = useMutation({
    mutationFn: () =>
      api.patch(`/agents/${settingsTarget!.id}/optimization-settings`, {
        promptOptimizationEnabled: currentSettings?.promptOptimizationEnabled,
      }),
    onSuccess: () => {
      setSettingsTarget(null);
      setSettingsDraft(null);
    },
  });
  const requestDeletion = useMutation({
    mutationFn: (agentId: string) => api.post(`/agents/${agentId}/request-deletion`, {}),
    onSuccess: () => {
      setDeletionTarget(null);
      void queryClient.invalidateQueries({ queryKey: ['agents'] });
      void queryClient.invalidateQueries({ queryKey: ['agent-deletions', 'mine'] });
    },
  });
  const confirmDeletion = useMutation({
    mutationFn: (deletionId: string) => api.post(`/agent-deletions/${deletionId}/confirm`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['agents'] });
      void queryClient.invalidateQueries({ queryKey: ['agent-deletions', 'mine'] });
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    registration.mutate();
  }
  async function copyApiKey() {
    if (!apiKey) return;
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  const canApprove = user.role === 'org_admin' || user.role === 'team_lead';
  const openOptimization = (agent: Agent) => {
    setSettingsTarget(agent);
    setSettingsDraft(null);
    setCachePolicyDraft(null);
  };
  const currentSettings = settingsDraft ?? optimization.data;
  const currentCachePolicy = cachePolicyDraft ?? cachePolicy.data?.policy;
  const downloadExport = async (deletion: PendingDeletion) => {
    const response = await api.get(`/agent-deletions/${deletion.id}/download`, { responseType: 'blob' });
    const url = URL.createObjectURL(response.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = `agent-usage-${deletion.agentId}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-8">
      <section>
        <h1 className="mt-1 text-3xl font-semibold">{user.role === 'developer' ? 'My Agents' : 'Agents'}</h1>
      </section>
      {user.role === 'developer' && (
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-lg font-semibold">Register an agent</h2>
          <form onSubmit={submit} className="mt-5 grid gap-4 md:grid-cols-3">
            <label className="text-sm">
              Agent name
              <input
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
              />
            </label>
            <label className="text-sm">
              Team
              <select
                required
                value={teamId}
                onChange={(event) => setTeamId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
              >
                <option value="">Select a team</option>
                {teams.data?.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="self-end">
              <button
                disabled={registration.isPending || !teamId}
                className="rounded-lg bg-cyan-500 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50"
              >
                Register agent
              </button>
            </div>
          </form>
          {teams.data?.length === 0 && (
            <p className="mt-3 text-sm text-amber-300">
              You need a team assignment before registering an agent.
            </p>
          )}
          {registration.isError && (
            <p className="mt-3 text-sm text-red-300">{errorMessage(registration.error)}</p>
          )}
        </section>
      )}
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-lg font-semibold">
          {canApprove ? 'Agents and pending approvals' : 'My registered agents'}
        </h2>
        <div className="mt-5">
          {agents.isLoading ? (
            <p className="text-sm text-slate-400">Loading agents…</p>
          ) : (
            <AgentTable
              agents={agents.data ?? []}
              canApprove={canApprove}
              onRequestDeletion={canApprove ? setDeletionTarget : undefined}
              onConfigureOptimization={openOptimization}
            />
          )}
        </div>
      </section>
      {canApprove && deletions.data?.length ? (
        <section className="rounded-2xl border border-amber-500/40 bg-slate-900 p-5">
          <h2 className="text-lg font-semibold">Deletion exports awaiting your confirmation</h2>
          <p className="mt-1 text-sm text-amber-200">
            Download each CSV before confirming. Confirmation permanently deletes the agent and its usage
            history.
          </p>
          <div className="mt-4 space-y-3">
            {deletions.data.map((deletion) => {
              const agent = agents.data?.find((item) => item.id === deletion.agentId);
              return (
                <div
                  key={deletion.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-700 p-3"
                >
                  <div>
                    <p className="font-medium">{agent?.name ?? 'Pending agent deletion'}</p>
                    <p className="text-xs text-slate-400">
                      Requested {new Date(deletion.requestedAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => void downloadExport(deletion)}
                      className="rounded border border-cyan-400 px-3 py-2 text-sm text-cyan-300"
                    >
                      Download CSV
                    </button>
                    <button
                      onClick={() => {
                        if (
                          confirm(
                            'This permanently deletes the agent and all its usage history. This cannot be undone. Have you downloaded the CSV export?',
                          )
                        )
                          confirmDeletion.mutate(deletion.id);
                      }}
                      disabled={confirmDeletion.isPending}
                      className="rounded border border-red-500/70 px-3 py-2 text-sm text-red-300"
                    >
                      Confirm deletion
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {confirmDeletion.isError && (
            <p className="mt-3 text-sm text-red-300">{errorMessage(confirmDeletion.error)}</p>
          )}
        </section>
      ) : null}
      {apiKey && (
        <div className="app-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
          <section
            role="dialog"
            aria-modal="true"
            className="w-full max-w-lg rounded-2xl border border-cyan-500/50 bg-slate-900 p-6 shadow-2xl"
          >
            <h2 className="text-xl font-semibold">Copy this API key now</h2>
            <p className="mt-2 text-sm text-amber-300">
              This is the only time the raw key is shown. Store it securely.
            </p>
            <code className="mt-5 block break-all rounded-lg bg-slate-950 p-3 text-sm text-cyan-300">
              {apiKey}
            </code>
            <div className="mt-5 flex items-center gap-3">
              <button
                onClick={copyApiKey}
                className="rounded-lg bg-cyan-500 px-4 py-2 font-semibold text-slate-950"
              >
                {copied ? 'Copied!' : 'Copy key'}
              </button>
              <button
                onClick={() => setApiKey(null)}
                className="rounded-lg border border-slate-700 px-4 py-2"
              >
                Close
              </button>
              {copied && (
                <span role="status" className="text-sm text-emerald-300">
                  API key copied to clipboard.
                </span>
              )}
            </div>
          </section>
        </div>
      )}
      {deletionTarget && (
        <div className="app-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
          <section
            role="dialog"
            aria-modal="true"
            className="w-full max-w-lg rounded-2xl border border-amber-500/60 bg-slate-900 p-6"
          >
            <h2 className="text-xl font-semibold">Request agent deletion</h2>
            <p className="mt-3 text-sm leading-6 text-amber-200">
              This will generate a usage export and begin the deletion process. The agent remains active until
              deletion is confirmed.
            </p>
            <p className="mt-2 text-sm text-slate-300">
              Agent: <span className="font-medium text-white">{deletionTarget.name}</span>
            </p>
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => requestDeletion.mutate(deletionTarget.id)}
                disabled={requestDeletion.isPending}
                className="rounded-lg border border-red-500/70 px-4 py-2 text-red-300"
              >
                Generate export and request deletion
              </button>
              <button
                onClick={() => setDeletionTarget(null)}
                className="rounded-lg border border-slate-700 px-4 py-2"
              >
                Close
              </button>
            </div>
            {requestDeletion.isError && (
              <p className="mt-3 text-sm text-red-300">{errorMessage(requestDeletion.error)}</p>
            )}
          </section>
        </div>
      )}
      {settingsTarget && (
        <div className="app-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
          <section
            role="dialog"
            aria-modal="true"
            className="optimization-settings-modal max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-cyan-500/40 bg-slate-900 p-6"
          >
            <h2 className="text-xl font-semibold">Optimization settings</h2>
            <p className="mt-1 text-sm text-slate-400">{settingsTarget.name}</p>
            {optimization.isLoading || !currentSettings ? (
              <p className="mt-5 text-sm text-slate-400">Loading settings…</p>
            ) : (
              <div className="optimization-settings-fields mt-5 space-y-4">
                <label className="optimization-settings-toggle flex items-center justify-between gap-4 text-sm">
                  Prompt optimization
                  <input
                    type="checkbox"
                    checked={currentSettings.promptOptimizationEnabled}
                    onChange={(e) =>
                      setSettingsDraft({ ...currentSettings, promptOptimizationEnabled: e.target.checked })
                    }
                  />
                </label>
              </div>
            )}
            <div className="mt-4 flex gap-3">
              <button
                disabled={!currentSettings || saveOptimization.isPending}
                onClick={() => saveOptimization.mutate()}
                className="rounded-lg bg-cyan-500 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50"
              >
                Save prompt settings
              </button>
            </div>
            <div className="mt-6 border-t border-slate-700 pt-5">
              <h3 className="font-semibold">Response cache policy</h3>
              <p className="mt-1 text-sm text-slate-400">
                Caching is off until a complete policy is saved. Policy changes invalidate older entries.
              </p>
              {cachePolicy.data?.runtimeStatus !== 'active' && (
                <p role="status" className="mt-2 text-sm">
                  Cache runtime is paused. These controls prepare the policy; requests still go to the
                  provider.
                </p>
              )}
              {cachePolicy.isError && (
                <p role="alert" className="mt-2 text-sm">
                  {errorMessage(cachePolicy.error)}
                </p>
              )}
              {cachePolicy.isLoading || !currentCachePolicy ? (
                <p className="mt-3 text-sm">Loading cache policy…</p>
              ) : (
                <div className="mt-4 space-y-3 text-sm">
                  <label className="block">
                    Mode
                    <select
                      value={currentCachePolicy.mode}
                      onChange={(e) =>
                        setCachePolicyDraft({
                          ...currentCachePolicy,
                          mode: e.target.value as CachePolicy['mode'],
                        })
                      }
                      className="mt-1 w-full rounded-lg border px-3 py-2"
                    >
                      <option value="off">Off</option>
                      <option value="exact">Exact match</option>
                      <option value="exact_semantic">Exact, then semantic</option>
                    </select>
                  </label>
                  {(['workload', 'knowledgeVersion', 'promptVersion', 'workloadVersion'] as const).map(
                    (field) => (
                      <label key={field} className="block">
                        {field === 'workload'
                          ? 'Workload name'
                          : field === 'knowledgeVersion'
                            ? 'Knowledge version'
                            : field === 'promptVersion'
                              ? 'Prompt version'
                              : 'Workload version'}
                        <input
                          value={currentCachePolicy[field]}
                          onChange={(e) =>
                            setCachePolicyDraft({ ...currentCachePolicy, [field]: e.target.value })
                          }
                          className="mt-1 w-full rounded-lg border px-3 py-2"
                        />
                      </label>
                    ),
                  )}
                  <label className="block">
                    Data freshness
                    <select
                      value={currentCachePolicy.freshness}
                      onChange={(e) =>
                        setCachePolicyDraft({
                          ...currentCachePolicy,
                          freshness: e.target.value as CachePolicy['freshness'],
                        })
                      }
                      className="mt-1 w-full rounded-lg border px-3 py-2"
                    >
                      <option value="live">Live or changing — bypass cache</option>
                      <option value="versioned">Versioned knowledge</option>
                    </select>
                  </label>
                  <label className="block">
                    Data risk
                    <select
                      value={currentCachePolicy.risk}
                      onChange={(e) =>
                        setCachePolicyDraft({
                          ...currentCachePolicy,
                          risk: e.target.value as CachePolicy['risk'],
                        })
                      }
                      className="mt-1 w-full rounded-lg border px-3 py-2"
                    >
                      <option value="standard">Standard</option>
                      <option value="sensitive">Sensitive — bypass cache</option>
                      <option value="side_effecting">Changes data — bypass cache</option>
                    </select>
                  </label>
                  <label className="block">
                    Answer scope
                    <select
                      value={currentCachePolicy.scope}
                      onChange={(e) =>
                        setCachePolicyDraft({
                          ...currentCachePolicy,
                          scope: e.target.value as CachePolicy['scope'],
                        })
                      }
                      className="mt-1 w-full rounded-lg border px-3 py-2"
                    >
                      <option value="end_user">Per verified end user</option>
                      <option value="shared">Shared across end users</option>
                    </select>
                  </label>
                  <label className="flex items-center justify-between gap-3">
                    I permit storage of approved responses
                    <input
                      type="checkbox"
                      checked={currentCachePolicy.storageAllowed}
                      onChange={(e) =>
                        setCachePolicyDraft({ ...currentCachePolicy, storageAllowed: e.target.checked })
                      }
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3">
                    Allow exact matches for conversations
                    <input
                      type="checkbox"
                      checked={currentCachePolicy.allowConversationExact}
                      onChange={(e) =>
                        setCachePolicyDraft({
                          ...currentCachePolicy,
                          allowConversationExact: e.target.checked,
                        })
                      }
                    />
                  </label>
                  {currentCachePolicy.mode === 'exact_semantic' && (
                    <>
                      <label className="flex items-center justify-between gap-3">
                        I approve semantic reuse for this workload
                        <input
                          type="checkbox"
                          checked={currentCachePolicy.semanticApproved}
                          onChange={(e) =>
                            setCachePolicyDraft({ ...currentCachePolicy, semanticApproved: e.target.checked })
                          }
                        />
                      </label>
                      <label className="flex items-center justify-between gap-3">
                        For non-Gemini calls, send questions to Gemini for embeddings
                        <input
                          type="checkbox"
                          checked={currentCachePolicy.embeddingProvider === 'gemini'}
                          onChange={(e) =>
                            setCachePolicyDraft({
                              ...currentCachePolicy,
                              embeddingProvider: e.target.checked ? 'gemini' : undefined,
                            })
                          }
                        />
                      </label>
                      <label className="block">
                        Similarity threshold
                        <input
                          type="number"
                          min="0.8"
                          max="1"
                          step="0.01"
                          value={currentCachePolicy.similarityThreshold}
                          onChange={(e) =>
                            setCachePolicyDraft({
                              ...currentCachePolicy,
                              similarityThreshold: Number(e.target.value),
                            })
                          }
                          className="mt-1 w-full rounded-lg border px-3 py-2"
                        />
                      </label>
                    </>
                  )}
                  <label className="block">
                    Maximum lifetime (seconds, up to 86400)
                    <input
                      type="number"
                      min="1"
                      max="86400"
                      step="1"
                      value={currentCachePolicy.ttlSeconds}
                      onChange={(e) =>
                        setCachePolicyDraft({ ...currentCachePolicy, ttlSeconds: Number(e.target.value) })
                      }
                      className="mt-1 w-full rounded-lg border px-3 py-2"
                    />
                  </label>
                  <div className="flex flex-wrap gap-3">
                    <button
                      disabled={!cachePolicyDraft || saveCachePolicy.isPending}
                      onClick={() => saveCachePolicy.mutate()}
                      className="rounded-lg bg-cyan-500 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50"
                    >
                      Save cache policy
                    </button>
                    <button
                      disabled={purgeCache.isPending}
                      onClick={() => {
                        if (window.confirm('Purge all cached responses for this agent?')) purgeCache.mutate();
                      }}
                      className="rounded-lg border px-4 py-2"
                    >
                      Purge this agent’s cache
                    </button>
                  </div>
                  {saveCachePolicy.isError && <p role="alert">{errorMessage(saveCachePolicy.error)}</p>}
                  {purgeCache.isSuccess && <p role="status">This agent’s cache was purged.</p>}
                  {purgeCache.isError && <p role="alert">{errorMessage(purgeCache.error)}</p>}
                  <div className="border-t pt-3">
                    <h4 className="font-semibold">Recent cache decisions</h4>
                    {cacheDiagnostics.data?.length ? (
                      <ul className="mt-2 space-y-2">
                        {cacheDiagnostics.data.slice(0, 5).map((row, index) => (
                          <li key={`${row.createdAt}-${index}`} className="text-xs">
                            {row.outcome} · {row.reason} · {row.lookupLatencyMs} ms · {row.provider}
                            {row.model ? `/${row.model}` : ''}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-xs">No cache decisions recorded yet.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => {
                  setSettingsTarget(null);
                  setSettingsDraft(null);
                  setCachePolicyDraft(null);
                }}
                className="rounded-lg border border-slate-700 px-4 py-2"
              >
                Close
              </button>
            </div>
            {saveOptimization.isError && (
              <p className="mt-3 text-sm text-red-300">{errorMessage(saveOptimization.error)}</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

import {
  CachePolicy,
  CACHE_SCHEMA_VERSION,
} from '../../src/features/optimization/cache/cache.policy';
import {
  evaluateCacheRequest,
  TrustedCacheContext,
} from '../../src/features/optimization/cache/cache.identity';

export const policy: CachePolicy = {
  mode: 'exact_semantic',
  workload: 'documentation',
  storageAllowed: true,
  scope: 'shared',
  risk: 'standard',
  freshness: 'versioned',
  allowConversationExact: false,
  semanticApproved: true,
  ttlSeconds: 3600,
  similarityThreshold: 0.95,
  knowledgeVersion: 'docs-1',
  promptVersion: 'prompt-1',
  workloadVersion: '1',
};
export const context: TrustedCacheContext = {
  orgId: '00000000-0000-4000-8000-000000000001',
  agentId: '00000000-0000-4000-8000-000000000002',
  environment: 'prod',
  providerCredentialVersion: 'key-v1',
  providerApiVersion: 'api-v1',
  modelRevision: 'pinned-release-1',
  transformationVersion: 'none',
  embeddingModelVersion: 'gemini-embedding-001:768:v1',
};
export const body = {
  model: 'test-model',
  temperature: 0,
  messages: [
    { role: 'system', content: 'Use documentation version 1.' },
    { role: 'user', content: 'How do I sign in?' },
  ],
};
export const input = {
  provider: 'openai' as const,
  path: '/v1/chat/completions',
  body,
  policy: { schemaVersion: CACHE_SCHEMA_VERSION, revision: 1, policy },
  context,
};
export function allowed(override: Partial<Parameters<typeof evaluateCacheRequest>[0]> = {}) {
  const decision = evaluateCacheRequest({ ...input, ...override });
  if (decision.outcome === 'cache_bypassed') throw new Error(decision.reason);
  return decision;
}

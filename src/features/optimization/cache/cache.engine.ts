import axios from 'axios';
import { randomUUID } from 'crypto';
import { env } from '../../../config/env';
import { redis } from '../../../config/redis';
import { AuthenticatedAgent } from '../../../middleware/agentAuth';
import { providerKeysService } from '../../provider-keys/provider-keys.service';
import { pricingRepository } from '../../pricing/pricing.repository';
import { ProviderName, ProviderResponse } from '../../proxy/providers/provider.types';
import { optimizationRepository } from '../optimization.repository';
import { cacheDiagnostics, CacheDiagnostic } from './cache.diagnostics';
import { CacheDecision, evaluateCacheRequest } from './cache.identity';
import { cachePolicyRepository } from './cache.policy.repository';
import { cacheRepository, CacheScope } from './cache.repository';
import { canStoreCacheResponse } from './cache.response';
import { verifyCacheUserContext } from './cache.userContext';

export type CacheOptions = {
  environment: 'dev' | 'staging' | 'prod';
  taskId: string;
  userContextToken?: string;
};
export type CacheResult = {
  response?: ProviderResponse;
  outcome: 'bypass' | 'miss' | 'exact_hit' | 'semantic_hit';
  reason: string;
  decision?: CacheDecision;
  embedding?: number[];
  embeddingModelVersion?: string;
  transformationVersion?: string;
  fillLock?: { key: string; token: string };
  diagnostic: CacheDiagnostic;
};

const EMBEDDING_TIMEOUT_MS = 2000;
const FILL_WAIT_MS = 500;
const EMBEDDING_DIMENSIONS = 768;
export const CACHE_TRANSFORMATION_IMPLEMENTATION_VERSION = 'prompt-autocorrect-v1';

function scope(agent: AuthenticatedAgent): CacheScope {
  return { orgId: agent.orgId, agentId: agent.id };
}

export async function transformationVersion(agentId: string): Promise<string> {
  return `${CACHE_TRANSFORMATION_IMPLEMENTATION_VERSION}:${await optimizationRepository.getCacheTransformationVersion(agentId)}`;
}

function safeModel(model: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(model);
}

async function embed(question: string, orgId: string) {
  if (!safeModel(env.EMBEDDING_MODEL)) throw new Error('Invalid embedding model');
  const key = await providerKeysService.getPlaintext(orgId, 'gemini');
  if (!key) throw new Error('Organization Gemini key unavailable');
  const startedAt = Date.now();
  const result = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${env.EMBEDDING_MODEL}:embedContent`,
    {
      model: `models/${env.EMBEDDING_MODEL}`,
      content: { parts: [{ text: question }] },
      taskType: 'SEMANTIC_SIMILARITY',
      outputDimensionality: EMBEDDING_DIMENSIONS,
    },
    { params: { key }, timeout: EMBEDDING_TIMEOUT_MS }
  );
  const values: unknown = result.data?.embedding?.values;
  if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS ||
      values.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error('Invalid embedding response');
  }
  const tokens: unknown = result.data?.usageMetadata?.promptTokenCount;
  const inputTokens = typeof tokens === 'number' && Number.isInteger(tokens) && tokens >= 0 ? tokens : undefined;
  const rate = inputTokens === undefined ? null : await pricingRepository.getRate(orgId, 'gemini', env.EMBEDDING_MODEL);
  return {
    values: values as number[],
    latencyMs: Date.now() - startedAt,
    inputTokens,
    costUsd: rate && inputTokens !== undefined ? ((inputTokens / 1000) * rate.inputPricePer1k).toFixed(6) : undefined,
  };
}

async function releaseFillLock(lock?: { key: string; token: string }): Promise<void> {
  if (!lock) return;
  await redis.eval(
    "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0",
    { keys: [lock.key], arguments: [lock.token] }
  );
}

export const cacheEngine = {
  async prepare(input: {
    agent: AuthenticatedAgent;
    provider: ProviderName;
    path: string;
    body: unknown;
    credentialVersion: string;
    options: CacheOptions;
  }): Promise<CacheResult> {
    const startedAt = Date.now();
    const { agent, provider, path, body, options } = input;
    const diagnostic: CacheDiagnostic = {
      scope: scope(agent), taskId: options.taskId, provider, model: null,
      outcome: 'bypass', reason: 'policy_off', lookupLatencyMs: 0,
    };
    const finish = (outcome: CacheResult['outcome'], reason: string, extra: Partial<CacheResult> = {}): CacheResult => {
      diagnostic.outcome = outcome;
      diagnostic.reason = reason;
      diagnostic.lookupLatencyMs = Date.now() - startedAt;
      return { outcome, reason, diagnostic, ...extra };
    };
    try {
      const envelope = await cachePolicyRepository.get(agent.orgId, agent.id);
      if (!envelope.configured || envelope.policy.mode === 'off') return finish('bypass', 'policy_off');
      const user = verifyCacheUserContext(options.userContextToken, agent);
      const version = await transformationVersion(agent.id);
      const embeddingModelVersion = `${env.EMBEDDING_MODEL}:${EMBEDDING_DIMENSIONS}:semantic-similarity-v1`;
      const decision = evaluateCacheRequest({
        provider, path, body,
        policy: { schemaVersion: envelope.schemaVersion, revision: envelope.revision, policy: envelope.policy },
        context: {
          orgId: agent.orgId, agentId: agent.id, environment: options.environment,
          providerCredentialVersion: input.credentialVersion,
          providerApiVersion: path.startsWith('/v1beta/') ? 'v1beta' : 'v1',
          modelRevision: envelope.policy.workloadVersion,
          transformationVersion: version,
          embeddingModelVersion,
          ...(user ? { endUser: user } : {}),
        },
      });
      if (decision.outcome === 'cache_bypassed') return finish('bypass', decision.reason);
      diagnostic.model = decision.model;
      const exact = await cacheRepository.findExact(scope(agent), decision);
      if (exact && await cacheRepository.stillCurrent(scope(agent), decision) &&
          version === await transformationVersion(agent.id)) {
        return finish('exact_hit', 'exact_context_match', {
          response: { status: 200, data: exact.response, headers: { contentType: 'application/json' } },
        });
      }

      let embedding: number[] | undefined;
      if (decision.outcome === 'semantic_cache_allowed' &&
          (provider === 'gemini' || envelope.policy.embeddingProvider === 'gemini')) {
        try {
          const result = await embed(decision.question!, agent.orgId);
          embedding = result.values;
          diagnostic.embeddingLatencyMs = result.latencyMs;
          diagnostic.embeddingInputTokens = result.inputTokens;
          diagnostic.embeddingCostUsd = result.costUsd;
          diagnostic.embeddingCostStatus = result.costUsd ? 'estimated' : 'unknown';
          const semantic = await cacheRepository.findSemantic(scope(agent), decision, embeddingModelVersion, embedding);
          if (semantic && await cacheRepository.stillCurrent(scope(agent), decision) &&
              version === await transformationVersion(agent.id)) {
            return finish('semantic_hit', 'approved_partition_similarity', {
              response: { status: 200, data: semantic.entry.response, headers: { contentType: 'application/json' } },
            });
          }
        } catch {
          // Embedding is optional: exact cache remains usable and provider forwarding continues.
          diagnostic.embeddingCostStatus = 'unknown';
          return finish('miss', 'embedding_unavailable', { decision, transformationVersion: version });
        }
      }

      // Bound duplicate fills across instances. A waiter falls through to the
      // provider after 500 ms; cache contention never blocks a request forever.
      const key = `cache:v2:fill:${agent.orgId}:${agent.id}:${decision.exactKey}`;
      const token = randomUUID();
      let fillLock: CacheResult['fillLock'];
      try {
        if (await redis.set(key, token, { NX: true, PX: 30000 })) fillLock = { key, token };
        else {
          const deadline = Date.now() + FILL_WAIT_MS;
          while (Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 50));
            const filled = await cacheRepository.findExact(scope(agent), decision);
            if (filled && await cacheRepository.stillCurrent(scope(agent), decision) &&
                version === await transformationVersion(agent.id)) {
              return finish('exact_hit', 'concurrent_fill', {
                response: { status: 200, data: filled.response, headers: { contentType: 'application/json' } },
              });
            }
          }
        }
      } catch {
        // Redis coordination is best effort; the provider remains available.
      }
      return finish('miss', 'no_matching_entry', { decision, embedding, embeddingModelVersion, transformationVersion: version, fillLock });
    } catch {
      return finish('bypass', 'cache_unavailable');
    }
  },

  async afterProvider(input: {
    agent: AuthenticatedAgent;
    provider: ProviderName;
    result: CacheResult;
    response: ProviderResponse;
  }): Promise<void> {
    const { result, agent, provider, response } = input;
    try {
      const decision = result.decision;
      if (!decision || !canStoreCacheResponse(decision, provider, response.status, response.data)) return;
      if (decision.outcome === 'cache_bypassed') return;
      if (result.transformationVersion !== await transformationVersion(agent.id)) return;
      await cacheRepository.store({
        scope: scope(agent), decision, provider, model: decision.model,
        response: response.data, embedding: result.embedding,
        embeddingModelVersion: result.embedding ? result.embeddingModelVersion : undefined,
      });
    } catch {
      // A cache write failure must never change the provider response.
    } finally {
      try { await releaseFillLock(result.fillLock); } catch { /* short lock TTL is a fallback */ }
    }
  },

  async abort(result?: CacheResult): Promise<void> {
    try { await releaseFillLock(result?.fillLock); } catch { /* expires automatically */ }
  },

  async record(result: CacheResult): Promise<void> {
    try { await cacheDiagnostics.record(result.diagnostic); } catch { /* diagnostic failure is nonfatal */ }
  },
};

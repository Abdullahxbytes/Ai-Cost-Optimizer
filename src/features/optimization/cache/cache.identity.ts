import { createHash } from 'crypto';
import { z } from 'zod';
import { CACHE_SCHEMA_VERSION, policyEnvelopeSchema } from './cache.policy';
import { CacheProvider, parseCacheRequest } from './cache.request';

const nonempty = z.string().min(1).max(256);
// Construct ONLY from authenticated/server-controlled context. Never cast an
// X-User-ID (or any other caller header) to this type in the proxy controller.
export const trustedCacheContextSchema = z
  .object({
    orgId: z.string().uuid(),
    agentId: z.string().uuid(),
    environment: z.enum(['dev', 'staging', 'prod']),
    providerCredentialVersion: nonempty,
    providerApiVersion: nonempty,
    modelRevision: nonempty,
    transformationVersion: nonempty,
    embeddingModelVersion: nonempty.optional(),
    endUser: z.object({ subject: nonempty, authorizationVersion: nonempty }).strict().optional(),
  })
  .strict();
export type TrustedCacheContext = z.infer<typeof trustedCacheContextSchema>;

function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  throw new Error('Not a JSON request');
}
function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

export type CacheDecision =
  | { outcome: 'cache_bypassed'; reason: string }
  | {
      outcome: 'exact_cache_allowed' | 'semantic_cache_allowed';
      reason: string;
      schemaVersion: number;
      policyRevision: number;
      exactKey: string;
      partitionKey: string | null;
      question: string | null;
      ttlSeconds: number;
      similarityThreshold: number;
      provider: CacheProvider;
      model: string;
    };

export function evaluateCacheRequest(input: {
  provider: CacheProvider;
  path: string;
  body: unknown;
  policy: unknown;
  context: unknown;
}): CacheDecision {
  const bypass = (reason: string): CacheDecision => ({ outcome: 'cache_bypassed', reason });
  const envelope = policyEnvelopeSchema.safeParse(input.policy);
  if (!envelope.success) return bypass('missing_or_invalid_policy');
  const { policy, revision } = envelope.data;
  if (policy.mode === 'off') return bypass('policy_off');
  const context = trustedCacheContextSchema.safeParse(input.context);
  if (!context.success) return bypass('missing_trusted_context');
  if (policy.scope === 'end_user' && !context.data.endUser) return bypass('missing_end_user_scope');
  // Do not discard a known user just because a shared workload was declared.
  const request = parseCacheRequest(input.provider, input.path, input.body);
  if (!request) return bypass('unsupported_request');
  if (request.conversation && !policy.allowConversationExact)
    return bypass('conversation_not_approved');
  try {
    const namespace = {
      schemaVersion: CACHE_SCHEMA_VERSION,
      revision,
      policy,
      context: context.data,
      provider: input.provider,
      endpoint: request.endpoint,
      model: request.model,
    };
    const exactKey = digest({ namespace, body: input.body });
    const semantic =
      policy.mode === 'exact_semantic' &&
      !request.conversation &&
      request.question !== null &&
      !!context.data.embeddingModelVersion;
    return {
      outcome: semantic ? 'semantic_cache_allowed' : 'exact_cache_allowed',
      reason: semantic ? 'approved_semantic_workload' : 'full_context_exact_match_required',
      schemaVersion: CACHE_SCHEMA_VERSION,
      policyRevision: revision,
      exactKey,
      partitionKey: semantic
        ? digest({ namespace, fixedRequestContext: request.semanticContext })
        : null,
      question: semantic ? request.question : null,
      ttlSeconds: policy.ttlSeconds,
      similarityThreshold: policy.similarityThreshold,
      provider: input.provider,
      model: request.model,
    };
  } catch {
    return bypass('invalid_json_request');
  }
}

// Shared invariant for Stage 2 readers. Old rows lack these fields and fail
// closed. A similarity score alone is never permission to reuse an entry.
export function isCurrentCacheEntry(
  entry: {
    schemaVersion?: number;
    policyRevision?: number;
    exactKey?: string;
    partitionKey?: string | null;
    createdAt?: Date;
    expiresAt?: Date;
  },
  decision: CacheDecision,
  kind: 'exact' | 'semantic',
  now = new Date()
): boolean {
  if (
    decision.outcome === 'cache_bypassed' ||
    entry.schemaVersion !== CACHE_SCHEMA_VERSION ||
    entry.policyRevision !== decision.policyRevision ||
    !entry.createdAt ||
    !entry.expiresAt
  )
    return false;
  const age = now.getTime() - entry.createdAt.getTime();
  if (
    !Number.isFinite(age) ||
    age < 0 ||
    age >= decision.ttlSeconds * 1000 ||
    !Number.isFinite(entry.expiresAt.getTime()) ||
    entry.expiresAt <= now
  )
    return false;
  return kind === 'exact'
    ? entry.exactKey === decision.exactKey
    : decision.outcome === 'semantic_cache_allowed' &&
        !!decision.partitionKey &&
        entry.partitionKey === decision.partitionKey;
}

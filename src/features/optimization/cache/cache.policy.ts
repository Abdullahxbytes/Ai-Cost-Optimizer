import { z } from 'zod';

export const CACHE_SCHEMA_VERSION = 2;
export const CACHE_RUNTIME_STATUS = 'active' as const;
const version = z.string().trim().min(1).max(128);

// These are declarations made by the workload owner, not conclusions inferred
// from a prompt. No classifier can establish freshness or authorization alone.
export const cachePolicySchema = z
  .object({
    mode: z.enum(['off', 'exact', 'exact_semantic']),
    workload: version,
    storageAllowed: z.boolean(),
    scope: z.enum(['shared', 'end_user']),
    risk: z.enum(['standard', 'sensitive', 'side_effecting']),
    freshness: z.enum(['versioned', 'live']),
    allowConversationExact: z.boolean(),
    semanticApproved: z.boolean(),
    // Required before a non-Gemini request may use Gemini for embeddings.
    embeddingProvider: z.literal('gemini').optional(),
    ttlSeconds: z.number().int().min(1).max(86400),
    similarityThreshold: z.number().min(0.8).max(1),
    knowledgeVersion: version,
    promptVersion: version,
    workloadVersion: version,
  })
  .strict()
  .superRefine((policy, ctx) => {
    if (
      policy.mode !== 'off' &&
      (!policy.storageAllowed || policy.risk !== 'standard' || policy.freshness !== 'versioned')
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Active caching requires storage permission, standard risk, and versioned data',
      });
    }
    if (policy.mode === 'exact_semantic' && !policy.semanticApproved) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Semantic caching requires explicit workload approval',
      });
    }
  });

export type CachePolicy = z.infer<typeof cachePolicySchema>;
export const DEFAULT_CACHE_POLICY: Readonly<CachePolicy> = Object.freeze({
  mode: 'off',
  workload: 'unconfigured',
  storageAllowed: false,
  scope: 'end_user',
  risk: 'standard',
  freshness: 'live',
  allowConversationExact: false,
  semanticApproved: false,
  ttlSeconds: 3600,
  similarityThreshold: 0.92,
  knowledgeVersion: 'unconfigured',
  promptVersion: 'unconfigured',
  workloadVersion: 'unconfigured',
});

export const policyEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(CACHE_SCHEMA_VERSION),
    revision: z.number().int().positive(),
    policy: cachePolicySchema,
  })
  .strict();

export type PolicyEnvelope = z.infer<typeof policyEnvelopeSchema>;

# Cache safety: Stage 1

Implemented 2026-10-07. This documents the Stage 1 policy/schema foundation;
the Stage 2 runtime is documented in [Cache Stage 2](CACHE_STAGE_TWO.md). Neither
stage establishes production accuracy or measured net savings.

## Runtime transition

- Legacy `semantic_cache` lookup and insertion are disconnected from the proxy.
  Its rows, prior settings, and historical usage remain untouched. Existing
  expiry/deletion mechanisms can still remove legacy data.
- During Stage 1, successful requests reached the provider and no cache
  embeddings were generated. Stage 2 now enables exact/semantic caching only
  for owner-approved V2 policies; legacy rows remain ineligible.
- The shared Agents settings page disables legacy cache controls and still
  allows prompt-optimization changes.
- Do not run `verifyByokSemanticCacheHttp.ts`: it targets retired behavior.

## Policy API

`GET /agents/:agentId/cache-policy` reads a policy. `PUT` replaces the complete
policy; partial payloads and unknown fields fail validation. Both use existing
org-admin, team-lead and developer agent-scope authorization and existing
authentication/rate-limit/UUID middleware. Finance/auditor roles cannot mutate it.
Policies are not inferred or opted in automatically from old toggles.

Each write atomically increments a revision and records `cache_policy_updated`
in the audit log. Disabling then reenabling cannot resurrect older entries.
Audit metadata contains mode/revision/schema version, not prompts, responses,
secrets or customer application end-user IDs. Missing/malformed policies are off.

Example for an owner-approved, nonpersonal documentation workload:

```json
{
  "mode": "exact_semantic",
  "workload": "product-documentation",
  "storageAllowed": true,
  "scope": "shared",
  "risk": "standard",
  "freshness": "versioned",
  "allowConversationExact": false,
  "semanticApproved": true,
  "ttlSeconds": 3600,
  "similarityThreshold": 0.95,
  "knowledgeVersion": "docs-2026-10-07",
  "promptVersion": "instructions-3",
  "workloadVersion": "documentation-1"
}
```

Modes: `off`, `exact`, `exact_semantic`. Active caching requires explicit storage
permission, standard risk and versioned data. Sensitive, live-data and
side-effecting workloads bypass. These declarations are owner responsibilities,
not automatic prompt classification. Eligible workloads need not be support bots.

TTL: 1–86,400 seconds, default 3,600. This cap is a retention guardrail, not a
guarantee that one hour is appropriate. Choose a workload-specific lifetime and
bump versions when source data changes. Similarity: 0.8–1; this is **not a
correctness probability**. Evaluate workloads before semantic activation.

## Request identity and decisions

The evaluator returns `cache_bypassed`, `exact_cache_allowed`, or
`semantic_cache_allowed`. The last means exact-first with semantic fallback
permitted, not that a matching answer was found.

Both identities include schema/policy revision, entire policy, provider,
endpoint, model, organization, agent, environment, provider credential version,
API version, owner-declared model/workload revision, prompt transformation
version, and any known end-user subject plus authorization version. Stage 2
constructs trusted context server-side; arbitrary `X-User-ID` is not accepted.
Without verified signed context an end-user workload is ineligible. Even shared
policies keep a known user in the partition. Hashing is not encryption/anonymization.

Exact keys also hash the full original JSON request. Only object-key order is
canonicalized; text, whitespace, punctuation, arrays, roles and history remain
intact. Identical requests still require valid expiry and knowledge versions.

Semantic partitions remove only one approved question text, preserving all other
context. History needs explicit exact-conversation opt-in and never gets semantic
fallback. Multiple text blocks fall back to exact. Stage 2 also filters by
embedding model/version and dimension, not just a similarity threshold.

Parsers cover supported plain-text OpenAI chat completions, Anthropic messages,
and Gemini generateContent settings. Unknown fields, query parameters/endpoints,
tools/functions/results, streaming, multimodal, provider-managed state, structured
output and external cached content bypass. **Bypass forwards normally; it does
not reject proxy traffic.** MCP execution/results are not separately cached.

The response guard allows only HTTP 200 completed plain text from the same
provider, excluding tools, refusals, partial/truncated/blocked outputs and errors.
The entry guard checks schema/revision/identity, declared expiry and current TTL;
it rejects legacy/future-dated entries. Stage 2 must recheck current policy after
provider completion so in-flight calls cannot write under a revoked policy.

## Schema, migration and rollback

New tables: `agent_cache_policies` and `response_cache_v2`. V2 stores versioned
digests, response JSON, expiry and optional 768-dimension embeddings with explicit
embedding-model version. The proxy neither reads nor writes it in Stage 1.
Responses/embeddings remain sensitive; application-level payload encryption and
durable V2 cleanup are not implemented here.

Migration is additive/transactional, requires existing pgvector, and does not
backfill, reinterpret, purge data, call providers or rotate credentials. Review
the destination database and take a backup before applying:

```powershell
npm run migrate:cache-stage-one
npm run migrate:cache-stage-one -- --apply
```

First command: dry run, no connection/writes. Apply executes only the targeted
`migrations/cache-stage-one.sql`, not broad `db:push`. Reruns are idempotent for
this schema, not a repair mechanism for incompatible existing tables. Apply
before using policy endpoints. No application/production migration runs
automatically. Test schema changes target only the dedicated test database.
Run the migration from a source checkout/admin job with development dependencies
installed (`tsx`); the slim production application image does not include this
administrative script. Do not add automatic schema mutation to application startup.

Rollback: leave additive tables and keep caching disabled. An older build with
semantic caching enabled would revive unsafe reuse; disable its semantic settings
for all agents before using it and verify misses. Dropping tables is unnecessary
and loses policies. Legacy purging requires a separate retention/backup decision.

## Stage 2 handoff / remaining limits

Implement V2 exact-first lookup/write with mandatory tenant/agent filters,
trusted-user verification, latest-policy invalidation and response checks,
bounded lookup/embedding timeouts, cleanup/purge audit, concurrency handling,
measured latency/overhead, policy UI and diagnostics. Cache-control requests may
narrow access, never override policy. The old zero-latency cache-hit writer has
been removed; new hit accounting must record actual measured latency.

No Jev/LLM classifier, model routing, native-provider prompt caching, billing
redesign, automatic sensitive-data detection or guarantee of answer equivalence
is included. Misdeclared workloads remain a risk. Evaluate negation, changing
numbers/dates/entities, access changes and stale data before making claims.

Verification: `npm run build`, `npm test -- tests/cache`, full `npm test`, and
`npm run build` in `frontend`. Provider responses in tests are mocked: no paid
provider calls or live customer load tests are implied.

Results (2026-10-07): full suite **164/164 passed, 29 suites**, including 62 cache
tests. Both builds passed; frontend reports its existing bundle-size warning.
Migration dry run and isolated-schema create/rerun tests passed. The application
database was not migrated and this stage was not deployed. Local PostgreSQL and
Redis containers were started for testing and left running.

# Cache Stage 2 implementation status

Updated 2026-10-09. V2 caching is now connected to the agent proxy, but remains
off for each agent until its owner saves an eligible policy. This is not proof
of semantic correctness or production net savings.

## Prepared controls

- V2 exact-key lookup and atomic upsert under the current agent policy revision.
  The unique key prevents duplicate rows. Tenant, agent, revision and expiry
  filters are mandatory on reads. A policy row lock excludes a concurrent
  replacement while an entry is written.
- Semantic candidate search additionally filters by partition and embedding
  model version, then checks the configured threshold. Similarity alone never
  authorizes reuse.
- Agent-scoped `DELETE /agents/:agentId/cache` removes both V2 and legacy rows
  and writes an audit record with counts. The shared Agents settings page asks
  for confirmation before calling it.
- `GET /agents/:agentId/cache-diagnostics` returns a bounded, tenant-scoped list
  without prompts, responses, API keys or end-user identifiers. It is empty
  until the runtime records decisions.
- Per-user scope can use `POST /agents/:agentId/cache-context` to issue a
  five-minute signed token. Only a dashboard user with access to the agent may
  issue it. A future proxy call must present it as
  `X-CostFlow-User-Context`. Configure a distinct
  `CACHE_CONTEXT_SIGNING_SECRET` of at least 32 characters. The token binds the
  organization, agent, end-user subject and customer supplied authorization
  version. Customer systems must refresh tokens and change that authorization
  version when access changes. Headers are redacted from application logs.
- The policy UI exposes storage consent, versioning, risk, freshness, personal
  scope and semantic approval. A separate opt-in is required before non-Gemini
  traffic can send question text to Gemini for embeddings. The legacy toggles
  are no longer presented as active controls.
- The proxy now checks exact V2 entries first. Approved semantic requests use
  the organization's Gemini key for a bounded embedding call and search only
  inside the matching tenant/agent/policy/context partition. Failures forward
  normally to the requested provider. There is no platform-key fallback.
- A short Redis fill lock reduces duplicate concurrent misses; waiters forward
  after at most 500 ms. Only complete plain-text responses are stored. Policy
  and prompt-setting versions are rechecked before reuse and storage.
- Hits generate zero-provider-token, zero-provider-cost usage events with
  measured latency. `X-CostFlow-Cache` identifies bypass, miss, exact hit, or
  semantic hit. Replayed native provider usage metadata refers to the original
  response; clients must use the cache header to avoid double counting.
- Embedding latency, tokens and estimated cost are diagnosed when available;
  missing usage or pricing is explicitly marked unknown. The current savings
  summary is an avoided-spend estimate, not an actual/avoided/net ledger.
- The expiry job includes V2 entries. It still requires its separate scheduler
  integration before expiry cleanup runs automatically in production.

## Migration

Stage 1's `agent_cache_policies` and `response_cache_v2` tables must exist first.
Stage 2 adds a unique exact-key index and `cache_request_diagnostics`. Review
the target and back it up before applying. Neither migration is run on the
application database automatically.

```powershell
npx tsx scripts/migrateCacheStageOne.ts --apply
npm run migrate:cache-stage-two
npx tsx scripts/migrateCacheStageTwo.ts --apply
```

The middle command is a dry run. The last applies only
`migrations/cache-stage-two.sql`. It will fail if duplicate V2 exact keys are
present; review and resolve duplicates deliberately, not by deleting rows
blindly. Run from a source checkout/admin job with development dependencies.

## Remaining rollout work

The runtime fails open if the V2 tables are not present, but an opted-in agent
will report `cache_unavailable` and receive no caching. Apply the additive
migrations to the intended application database after review and backup.
Both were applied to the verified local `ai_cost_optimizer` database after a
validated backup at `backups/costflow-before-cache-v2-20261009.dump` (ignored by
Git). No production or other database was migrated. There were no paid
provider calls or production load tests. The cache cleanup
job still needs production scheduling. Evaluate representative workloads for
false hits, stale answers, latency, embedding overhead and actual net savings
before a customer rollout. Keep workload, knowledge, prompt and model versions
current when behavior or source content changes; an unpinned provider model
alias cannot guarantee that the underlying model stays the same.

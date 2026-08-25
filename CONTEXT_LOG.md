# Context Log — AI Cost Optimizer Development

## Week 1, Day 0 (Setup)

**Date**: 2024-01-08

### ✅ Completed Tasks

- [x] Directory structure created (src/, tests/, scripts/, public/)
- [x] All npm dependencies installed
- [x] TypeScript configuration (tsconfig.json)
- [x] ESLint and Prettier configuration
- [x] Environment validation with Zod (src/config/env.ts)
- [x] Fastify application bootstrap (src/app.ts)
- [x] Error handling middleware (src/middleware/errorHandler.ts)
- [x] Logging setup with Pino (src/utils/logger.ts)
- [x] JWT utilities (src/utils/jwt.ts)
- [x] Custom error classes (src/utils/errors.ts)
- [x] Request validators (src/utils/validators.ts)
- [x] Helper utilities (src/utils/helpers.ts)
- [x] Docker Compose setup (PostgreSQL + Redis)
- [x] Health check endpoint (/health)
- [x] README with quick start instructions
- [x] .gitignore and configuration files

### 📊 Schema Changes

**None yet** — Schema design starts Day 1, Module 1

### 🔌 Live API Endpoints

| Endpoint | Method | Status     |
| -------- | ------ | ---------- |
| /health  | GET    | ✅ Working |

### 🚧 Blockers

**None** — Project is ready for Day 1 development

### 🎯 Tomorrow (Day 1, Module 1)

**Focus**: Drizzle ORM Schema Design

- [ ] Design database schema (users, organizations, teams, agents, budgets, usage events, alerts)
- [ ] Create Drizzle table definitions (src/schemas/index.ts)
- [ ] Set up database migrations
- [ ] Seed database with test data (scripts/seed.ts)
- [ ] Implement authentication service (src/services/authService.ts)
- [ ] Create auth routes (src/routes/auth.ts) — POST /signup, /login, /verify-2fa

**Expected deliverables**:

- Fully functional user authentication
- JWT token generation and validation
- Test users and organizations in database
- Auth middleware integrated

### 📝 Notes

- Boilerplate is intentionally minimal — just framework, DB, Redis, error handling
- Route files created but empty (to be filled in during Day 1-4)
- All dependencies installed and ready
- Docker containers not yet running (start with `npm run docker:up` when ready)
- Frontend deferred to Week 3 or separate repo

### ⚡ Quick Commands Reference

```bash
# Start development
npm run dev

# Start Docker
npm run docker:up

# Stop Docker
npm run docker:down

# Check health
curl http://localhost:3000/health

# Build
npm run build

# Lint
npm run lint
```

---

## Week 1, Day 1, Module 3 (Migration & Verification)

- **Completed**: Drizzle Kit configuration added; Docker Compose uses `pgvector/pgvector:pg16`.
- **Schema changes**: The schema is ready to push, including the `vector(1536)` semantic-cache embedding column.
- **Blocker**: Docker CLI is unavailable in the current environment, so Postgres cannot be recreated, the `vector` extension cannot be enabled, and live schema push/catalog verification cannot run here.
- **Next step**: With Docker available, recreate the Postgres volume, run `CREATE EXTENSION IF NOT EXISTS vector;`, then run `npm run db:push` and the catalog checks.

---

## 2026-08-13 — Drizzle pgvector schema push check

- **Drizzle upgrade**: `drizzle-orm` is now `0.45.2` and `drizzle-kit` is `0.31.10`.
- **Vector fix**: Replaced the `customType()` vector workaround in `src/schemas/index.ts` with native `vector('embedding', { dimensions: 1536 })`, matching `EMBEDDING_MODEL=text-embedding-3-small`.
- **Validation**: `npx tsc --noEmit` passed with zero errors.
- **Schema push**: `npm run db:push` exited with code 0 but emitted only the `push:pg` deprecation notice; catalog verification found 16 tables rather than the expected 22, so the schema push did not complete. The `vector` extension is installed.

---

## 2026-08-13 — Drizzle Kit push CLI/config update

- **CLI syntax fix**: Updated `package.json` from `drizzle-kit push:pg` to `drizzle-kit push`.
- **Config fix**: Replaced the obsolete PostgreSQL selector `driver: 'pg'` with `dialect: 'postgresql'` in `drizzle.config.ts`, as confirmed by Drizzle Kit `0.31.10` help output.
- **Validation**: `npx tsc --noEmit` passed with zero errors.
- **Push result**: The corrected command failed before schema activity with `A system error occurred: uv_os_get_passwd returned ENOMEM (not enough memory)`. Database state remains unverified after this run; the last catalog check showed 16 tables, with six expected tables absent.

---

## 2026-08-13 — Drizzle database credentials and full schema push

- **Node environment fix**: Node was switched from v24.14.0 to v22.11.0 LTS and dependencies were reinstalled, resolving the earlier libuv `uv_os_get_passwd` ENOMEM failure.
- **Config fix**: Updated `dbCredentials.connectionString` to Drizzle Kit's required `dbCredentials.url: process.env.DATABASE_URL!`; `drizzle.config.ts` already loads `.env` via `import 'dotenv/config'`.
- **Validation**: `npx tsc --noEmit` passed with zero errors.
- **Schema push**: `npm run db:push` completed successfully with `[✓] Changes applied`.
- **Catalog verification**: `\dt` reports 22 tables: access_grants, agent_approvals, agent_deletions, agent_tasks, agents, alert_history, alerts, audit_log, budget_requests, budgets, notifications, optimization_rules, orgs, pricing_changelog, pricing_table, routing_rules, semantic_cache, teams, usage_events, usage_rollup_daily, usage_rollup_hourly, and users.

---

## 2026-08-13 — Module 3 final verification

- **Index verification**: `\di` reports 40 indexes. All required indexes are present: `idx_agents_api_key_unique`, `idx_users_org_id_email_unique`, `idx_usage_events_org_id_agent_id_created_at`, and `idx_pricing_table_org_id_provider_model_effective_date`.
- **Sanity insert**: Inserted and selected a `Test Org` record using `gen_random_uuid()`; UUID and timestamp defaults worked correctly. The test record was removed with `DELETE 1`.
- **Extensions**: `pgcrypto` did not need to be added; `gen_random_uuid()` was already available.
- **Status**: Module 3 is fully complete.

---

## 2026-08-13 — Day 1, Module 4 seed data and RBAC validation

- **Seed**: Added an idempotent `scripts/seed.ts` and ran `npm run seed` successfully. It creates three active organizations (Acme Corp, Globex Inc, Initech), 33 tenant users, 9 teams (including one sub-team per org), 18 agents, 12 approvals, constrained budgets, pricing, 54 usage events, tasks, alerts, audit entries, and support access grants.
- **System Super Admin**: No `super_admin` is seeded in `users`, because `users.org_id` is non-null. The three support grants target external system-super-admin ID `00000000-0000-0000-0000-000000000001`.
- **Final row counts**: access_grants 3; agent_approvals 12; agent_deletions 0; agent_tasks 9; agents 18; alert_history 3; alerts 9; audit_log 9; budget_requests 3; budgets 21; notifications 0; optimization_rules 0; orgs 3; pricing_changelog 0; pricing_table 4; routing_rules 0; semantic_cache 0; teams 9; usage_events 54; usage_rollup_daily 0; usage_rollup_hourly 0; users 33.
- **Role/state coverage**: users — org_admin 6, team_lead 6, developer 15, finance 3, auditor 3; agents — pending_approval 6, active 9, paused 3.
- **RBAC validation**: Acme developer query returned only five Acme developers. An active Platform agent joins to its $1,200 budget and Platform's $5,000 team budget. The assigned sub-team lead sees 2 sub-team agents; the parent-team lead sees 0. Platform agent-budget sum is $1,200 ≤ $5,000. Acme's OpenAI/gpt-4o lookup returns its override ($0.0040 input / $0.0120 output per 1K), rather than the global rate.
- **Status**: Module 4 seed data and SQL-level access-scoping validation are complete.

---

## Key Architecture Decisions

- **Feature-based restructure (Day 2)**: Schema ownership now lives in `src/features/*/*.schema.db.ts`, with `src/db/schema.ts` as the sole Drizzle entrypoint. Route registration is centralized in `src/features/features.routes.ts`; authentication is split into user routes, controller, service, and repository. The temporary agent-auth and RBAC proof endpoints (`/agent-test/ping`, `/admin/orgs`, and `/teams/:teamId`) were removed. `npx tsc --noEmit` passes after the move. This checkout contains no Jest test files, so the prior live Day 1-2 flow suite could not be rerun here; it remains to be exercised against the configured live environment.
- **Post-restructure live verification (2026-08-20)**: PostgreSQL and Redis were healthy and `npm run dev` stayed running. `GET /health` returned `200`. A fresh signup returned `201` with `orgId`, `userId`, and email; valid login returned `200` with `pendingToken` and `twoFactorConfigured: false`; invalid-password login returned `401 {"error":"Invalid credentials","code":"AUTH_ERROR"}`. 2FA setup returned `200` with a QR-code data URL and manual key; a real generated TOTP verified with `200`, returning a session JWT and the expected `org_admin` principal. Temporary verification-only routes were used and then removed: Developer-to-Super-Admin access returned `403 {"error":"Insufficient permissions","code":"FORBIDDEN"}`; cross-org Org Admin access returned `403 {"error":"Organization access denied","code":"FORBIDDEN"}`; pending and paused agents returned `403`, while an active agent returned `200`. The development command now explicitly preloads the existing `.env` via `dotenv -- tsx watch src/app.ts`.
- **User-role folder consolidation (2026-08-20)**: Removed the unused `user/org_admin`, `user/team_lead`, `user/developer`, `user/finance`, `user/auditor`, and `user/super_admin` folders. The single `user.schema.db.ts` now owns `users`, `super_admins`, and `access_grants`; user route/controller/service/repository files remain the sole account/auth layers. Post-change live verification passed: health `200`; signup `201`; valid login `200`; invalid-password login `401`; 2FA setup `200`; TOTP verification/session `200`; Developer-to-Super-Admin and cross-org access `403`; pending/paused agent keys `403`; active agent key `200`. Temporary verification endpoints were removed after the checks.
- **Day 3 Module 1 — Proxy forwarding (2026-08-24)**: Added `POST /proxy/:provider/*`, protected by existing `agentAuth`, plus controller/service/repository and OpenAI, Anthropic, and Gemini provider adapters. Provider API keys remain platform-held environment values; agents never supply provider keys. No cost, usage, budget, cache, or optimization logic was added. A paused seeded agent was rejected with `403` before forwarding. A controlled adapter test confirmed an active agent receives a `200` response with the original provider path/body and that the adapter is called exactly once. The configured OpenAI key returned OpenAI's real `401 invalid_api_key`, which the proxy now passes through unchanged; a real completion cannot be verified until a valid `OPENAI_API_KEY` is configured.
- **Day 3 Module 2 — Cost calculation and usage logging (2026-08-24)**: Added `pricingRepository.getRate()` with organization override first and global fallback, provider-specific usage extraction, and fire-and-forget successful-call usage logging. Missing usage or pricing records a zero-token/zero-cost event (with warnings) because `usage_events.cost_usd` is non-null; this is a known pricing-data gap and does not block the agent response. Controlled end-to-end test with a seeded active Acme agent, the organization OpenAI `gpt-4o` rate (`$0.0040` input / `$0.0120` output per 1K), and a mocked successful provider response wrote two `usage_events` rows for one task: steps `1` and `2`, `1000` input tokens, `500` output tokens, `0.0100 USD` cost, `staging` environment, and `is_test: true`. The cost matched `(1000/1000 × 0.0040) + (500/1000 × 0.0120) = 0.0100`.
- **Day 3 Module 3 — Budget enforcement and kill switch (2026-08-24)**: Added budget lookup by scope and Redis-backed pre-forward enforcement. The proxy now checks the agent kill-switch key before any provider work, then checks configured agent, team, and organization budgets using timezone-aware daily/monthly period keys. Successful non-test usage writes increment applicable scoped counters with 25-hour (daily) or 32-day (monthly) TTLs. `X-Is-Test: true` skips budget enforcement and counters, but deliberately does **not** bypass the kill switch: a kill switch is a safety gate, not spend accounting.
- **Module 3 verification note (2026-08-24)**: `npx tsc --noEmit` passes. PostgreSQL and Redis were started and Redis responded to `PING`; a temporary seeded-agent kill-switch key was set and then removed. The requested HTTP live checks could not complete because an existing process on port 3000 returned `500`, while a newly started proxy could not bind (`EADDRINUSE`); rerun the kill-switch, budget-overrun, and test-header checks after stopping that process or using a free port.
- **Day 3 Module 4 — Rate limiting, retries, and error handling (2026-08-25)**: Added a global 60-request-per-minute per-agent Redis fixed-window limit (per-agent overrides require future schema work), enforced after kill-switch and budget checks. Provider calls have an explicit 30-second Axios timeout and now retry only retryable network/timeout/5xx failures for up to three total attempts with 200ms and 400ms backoff; upstream 4xx fail immediately. Attempted provider failures are normalized to `502 PROVIDER_ERROR` and asynchronously logged as zero-cost `usage_events` with `error` or `timeout` status, while proxy gate rejections create no usage event. Day 3 is functionally complete pending the local live-test rerun noted above.
- **Module 4 live verification (2026-08-25)**: Docker PostgreSQL and Redis were healthy (`PING` returned `PONG`). With a seeded active agent's current fixed-window Redis counter preloaded to `60`, a local proxy call on port `3001` returned `429 {"error":"Rate limit exceeded","code":"RATE_LIMIT","retryAfter":13}`. The temporary Redis key was removed after each check. Retry behavior remains compile-reviewed but needs a controlled mocked-adapter test for exact attempt counts.
- **Module 3 live verification (2026-08-25)**: Verified through the real Fastify proxy route, seeded PostgreSQL/Redis data, and a controlled Axios provider-boundary stub that counted adapter calls. Literal results: `kill-switch: 403 {"error":"Agent killed","code":"FORBIDDEN"}; adapterCalls=0`; `budget-exceeded: 429 {"error":"Budget exceeded","code":"BUDGET_EXCEEDED","scope":"agent"}; adapterCalls=0`; `over-budget-is-test: 200 {"id":"module-3-verification","usage":{"prompt_tokens":1,"completion_tokens":1}}; adapterCalls=1`; `killed-is-test: 403 {"error":"Agent killed","code":"FORBIDDEN"}; adapterCalls=0`. Temporary kill-switch and spend-counter keys were deleted in a `finally` cleanup.
- **Day 4 Module 1 — Semantic cache read path (2026-08-25)**: Added agent-scoped (`org_id` + `agent_id`) cache settings and pgvector cosine-similarity lookup. With semantic caching enabled, the proxy extracts provider-specific prompt text, generates a `text-embedding-3-small` embedding, and replays a freshened cached raw provider JSON response when similarity meets the agent-specific threshold. Cache hits increment `hit_count`, write a zero-cost `usage_events` cache hit, and never call a provider. Missing settings, disabled caching, unextractable text, or cache/embedding failure fall through to normal Day 3 forwarding. Embedding API calls are intentionally not separately cost-tracked.
- **Module 1 verification (2026-08-25)**: PostgreSQL/Redis containers were restored and healthy. The configured `EMBEDDING_API_KEY` is the placeholder `sk-xxx`, so a real `POST /v1/embeddings` correctly returned `401 invalid_api_key`; a valid key is required for the external API check. The complete local pgvector read path was then verified using controlled 1536-dimension embeddings and a temporary scoped cache row: cache hit returned `200 {"id":"cache-e61f9adb-2b73-4324-aad7-29a46ff7433f","created":1787637788,"choices":[{"message":{"content":"Paris"}}]}; providerCalls=0`; a distinct query returned `200 {"id":"provider-response","choices":[{"message":{"content":"Not cached"}}]}; providerCalls=1`. Temporary cache and optimization settings rows were removed.
- **Day 4 Module 2 — Semantic cache write path (2026-08-25)**: Successful non-test provider calls now asynchronously write agent-scoped cache entries only when that agent has semantic caching enabled. Entries reuse the read path's provider-specific prompt extraction, store full JSON-stringified provider responses, and use the configured TTL. Error responses, cache hits, disabled settings, missing prompt text, and test traffic are excluded. Implemented `cacheCleanup()` to remove expired rows; scheduler wiring remains shared deferred work across the jobs directory. The real embedding-key gap remains open because `.env` still uses the placeholder OpenAI embedding key.
- **Module 2 verification (2026-08-25)**: Controlled end-to-end test through the real Fastify route and temporary scoped settings/cache rows confirmed write → hit → test exclusion → cleanup. First non-test provider call returned `200`, invoked the provider once, and wrote `query_text`, JSON-stringified raw response, `hit_count: 0`, and a one-hour expiry. Repeating the query returned a cache-replayed `200` with `providerCalls=0`. A distinct `X-Is-Test: true` request reached the provider (`providerCalls=1`) and left `cacheRows=0`. An expired entry was inserted; `cacheCleanup()` returned `deleted=1` and subsequent lookup returned `expiredRows=0`. Temporary rows were removed. The real OpenAI embedding call remains unverified because `EMBEDDING_API_KEY` is still `sk-xxx`.
- **Embedding provider switch (2026-08-25)**: Confirmed `semantic_cache` had zero rows before migration. Switched the internal semantic-cache embedding call from OpenAI to Gemini `text-embedding-004`, using Gemini's documented `POST /v1beta/models/text-embedding-004:embedContent`, `x-goog-api-key`, `content.parts[].text`, and `embedding.values[]` contract. The vector schema was changed from `vector(1536)` to `vector(768)` and `npm run db:push` applied cleanly; PostgreSQL confirms `vector(768)`. A controlled 768-value contract test verified write → cache hit (`providerCalls=0`) and a distinct-query miss (`providerCalls=1`). The requested real Gemini end-to-end test is still blocked: `GEMINI_API_KEY` is absent from both `.env` and the process, so no authentic Gemini embedding or real similarity score is available yet. Controlled scores of `1` (same vector) and `0` (orthogonal vector) are test-only and must not be used to tune the `0.92` threshold.
- **Real Gemini embedding verification (2026-08-25)**: The supplied key authenticated, but Gemini returned `404 NOT_FOUND` for `text-embedding-004` on this project/API version. Model discovery showed supported embedding models `gemini-embedding-001`, `gemini-embedding-2-preview`, and `gemini-embedding-2`. Switched to supported `gemini-embedding-001` with Gemini's `outputDimensionality: 768`, which returned 768 values in a real request and remains compatible with `vector(768)`. Full real write → read verification through the Fastify proxy (with only the downstream provider completion stubbed) passed: an initial request generated a real Gemini embedding, called the provider once, and wrote the cache; the near paraphrase `Which city is the capital of France?` had cosine similarity `0.9938459605631018`, returned a cache hit with `providerCalls=0`; unrelated photosynthesis prompt similarity was `0.6545535117979778`, correctly fell through with `providerCalls=1`. The configured `0.92` threshold is appropriate for this sample and was not changed. Temporary settings/cache rows were removed.
- **Gemini proxy regression check (2026-08-25)**: The earlier `502` was caused solely by retired `gemini-2.5-flash`, not the Day 4 embedding change. Repeating through `POST /proxy/gemini/v1beta/models/gemini-3.6-flash:generateContent` returned `200` with Gemini's genuine `proxy sanity passed` completion. Its `usage_events` row recorded `provider=gemini`, `model=gemini-3.6-flash`, `input_tokens=7`, `output_tokens=3`, `cost_usd=0.0000` (no configured pricing row), `latency_ms=2313`, `status=success`, `is_test=false`, and `cache_hit=false`.
- **Day 4 Module 3 — Prompt optimization (2026-08-25)**: Added a conservative, rule-based miss-path optimizer after the semantic-cache lookup. It collapses whitespace, trims edges, and removes only exact adjacent sentences; cache embeddings and cache writes continue to use the original prompt. `injectOptimizedText()` reconstructs OpenAI, Anthropic, and Gemini bodies without changing unrelated fields; direct shape checks passed for all three. The per-agent `prompt_optimization_enabled` setting controls the feature; estimates use `Math.ceil(text.length / 4)` solely for `original_token_count` and `optimized_token_count`, while actual provider usage and billing remain authoritative. Controlled Fastify-route verification with a Gemini provider-boundary stub returned `200`: enabled forwarding changed `"  Keep   this instruction.\n\nKeep this instruction.\n\nAnswer   succinctly.  "` to `"Keep this instruction. Answer succinctly."`, with usage estimates `19 → 11`; disabled forwarding preserved the original body and recorded provider-token defaults `1000 → 1000`. A semantic cache hit returned `200`, recorded `$0.0000` with `0 → 0`, and made `0` provider calls, proving it exits before optimization. Temporary settings, cache, and usage test records were removed. `npx tsc --noEmit` passes.
- **Gemini 3.6 Flash pricing (2026-08-25)**: Added the global (`org_id = NULL`) `pricing_table` row for `gemini/gemini-3.6-flash` using Google's published standard-tier rates: `$0.000750` input and `$0.003750` output per 1K tokens. Increased only the pricing-rate column scale from four to six decimal places, then ran `npm run db:push`, so the sub-cent input rate is stored without rounding; `usage_events.cost_usd` remains unchanged.
- **Day 4 Module 4 — Settings endpoints and savings visibility (2026-08-25)**: Added authenticated optimization APIs: `GET/PATCH /agents/:agentId/optimization-settings`, `GET /agents/:agentId/savings-summary`, `GET /teams/:teamId/savings-summary`, and `GET /orgs/:orgId/savings-summary`. Agent settings use the existing RBAC helpers: Org Admins have organization access, Team Leads only their assigned team, and Developers only agents they own. Savings routes additionally support Finance on the organization view and Team Leads on their team view. A missing settings row reads as safe defaults (`false`, `false`, `0.92`, `3600s`); PATCH validates threshold `(0, 1]` and positive integer TTL, then atomically creates/updates the row. Added the required unique `optimization_rules.agent_id` index and pushed it with `npm run db:push`. Savings aggregation uses real `usage_events`; cache avoided-cost is explicitly documented as an estimate based on average non-cached cost for the same provider/model and selected range, and optimization savings use the current input-token price. Authenticated Fastify verification passed: owner Developer PATCH and subsequent GET returned `200` with `{promptOptimizationEnabled:true, semanticCacheEnabled:true, cacheSimilarityThreshold:0.93, cacheTtlSeconds:7200}`; a different Developer received `403 {error:"Agent access denied",code:"FORBIDDEN"}`; invalid threshold/TTL returned `400`. A temporary hand-calculated three-event fixture returned `totalCalls:3`, `totalCost:0.04`, `cacheHits:1`, `cacheHitRate:33.33`, estimated cache savings `0.02`, `totalTokensSaved:30`, and estimated optimization savings `0.0000225`, matching the fixture calculation. Test rows/settings were removed and `npx tsc --noEmit` passes. **Day 4 is complete.**
- **Day 5 Module 1 — Organization and team CRUD (2026-08-25)**: Added controller/service/repository layers for organizations and teams. `GET /orgs/:orgId` supports an in-scope Org Admin or any Super Admin; `PATCH /orgs/:orgId` is in-scope Org Admin only and explicitly rejects unsupported `currency`/`status` fields with `400` rather than silently ignoring them. Timezones are validated with `Intl.DateTimeFormat` IANA-zone validation. Added top-level team creation, role-scoped team listing, single-team GET, name update, Org-Admin-only lead reassignment, and one-level sub-team creation. The leadership assumption is explicit: only Org Admins can assign/reassign `teamLeadId`; Team Leads can rename only their own assigned team. Assigned leads must belong to the same organization. Team lists are role scoped: Org Admin sees all organization teams, Team Lead only explicitly led teams/sub-teams, and Developer only teams containing their owned agents. A live Fastify test created a temporary parent team and child team with different seeded leads: parent `200`, child `200`; the parent lead received `403 {error:"Team access denied",code:"FORBIDDEN"}` when requesting the child, while the assigned child lead got `200`. A nested-sub-team attempt returned `400 {error:"Cannot create a sub-team under a sub-team",code:"VALIDATION_ERROR"}`. A Developer team-lead edit returned `403`; an org PATCH containing `currency` returned `400`. Temporary teams were deleted. `npx tsc --noEmit` passes.
- **Day 5 Module 2 — Agent registration and approval lifecycle (2026-08-25)**: Added agent controller/service/repository layers and routes for Developer registration, scoped list/read, Team-Lead-or-Org-Admin approval/rejection, and owner/Team-Lead/Org-Admin pause/resume. Registration verifies the supplied team belongs to the caller's organization, creates a `pending_approval` agent plus 14-day pending approval request, and returns its generated `agt_…` API key only once. Every later agent read returns only `apiKeyMasked`. Pending approvals are lazily reported as expired on reads and cannot be approved after expiry; proactive expiry-job wiring remains future work. Rejection records `agent_approvals.status = rejected` and an `audit_log` event (including optional reason). **Schema gap retained intentionally:** `agent_status` has no `rejected` value, so rejected agents remain `pending_approval`; no enum value was invented. Real end-to-end Fastify verification passed: Developer registration `200`, masked read `200`, Team Lead approval `200` (`status=active`), then an actual Gemini `gemini-3.6-flash` proxy call using the newly returned agent key returned `200` with completion `lifecycle`; its usage row recorded `provider=gemini`, `model=gemini-3.6-flash`, `input_tokens=8`, `output_tokens=1`, `cost_usd=0.0000` (below the four-decimal usage-event monetary precision), `status=success`. A different Developer's pause attempt returned `403 {error:"Agent access denied",code:"FORBIDDEN"}`. A separately registered approval backdated past expiry returned `400 {error:"Agent approval request has expired",code:"VALIDATION_ERROR"}`. Test agents, approvals, audit events, and usage event were removed. `npx tsc --noEmit` passes.
- **Day 5 Module 3 — Budget CRUD and approval workflow (2026-08-25)**: Added budget controller/service/repository layers with scoped create/list, Org-Admin-only direct limit PATCH, and increase-request create/list/approve/reject routes. New budgets inherit `resetTimezone` from the organization's configured timezone. The agent-budget hard block is enforced before agent-budget creation, direct agent-budget increase, and approved agent-budget increase: the total agent budget for a team may not exceed its team budget; teams without a configured team budget have no ceiling. Team-vs-org and parent/sub-team pools are intentionally not constrained. The original case-by-case Team Lead delegation intent remains a known gap: approval is Org Admin only because no delegation schema exists. Live Fastify verification created a temporary team budget `$100` and agent budget `$80` (`200`), then rejected another agent budget `$30` with `400 {error:"Agent budgets for this team cannot exceed its 100 limit",code:"VALIDATION_ERROR"}`. A Developer requested `$90`; Org Admin approval returned `200` and changed the budget to `$90`. A Team Lead direct PATCH returned `403`. A `$95` increase request was rejected and the actual limit remained `$90`. All temporary budgets, requests, agents, approvals, and team were removed; `npx tsc --noEmit` passes.
- **Day 5 Module 4 — Agent deletion workflow (2026-08-25)**: Before implementation, catalog inspection found no existing FKs referencing `agents.id`; direct deletion would have left orphaned raw data. Added and pushed `ON DELETE CASCADE` constraints for `usage_events`, `agent_tasks`, `semantic_cache`, `optimization_rules`, and `agent_approvals`. Agent-scoped budgets are polymorphic (`scope_id`) and therefore have no FK; confirmation explicitly removes matching budgets and their budget requests in the same transaction. Local `exports/` (gitignored) is the development-only CSV storage substitute; production requires object storage. Added recipient-only request/download/confirm routes, CSV generation from that agent's usage history, and a three-day unconfirmed-deletion reminder-query function for future scheduler delivery. Requesting deletion moves the agent to `pending_deletion`, which remains valid in existing `agentAuth` and therefore proxy-capable. Confirmation snapshots essential approval facts (approver and decision time) into one deletion audit event before cascading `agent_approvals`, then removes the operational deletion row and CSV file. Live proof: a newly registered/approved agent made a real Gemini call (`200`), its deletion request returned `200`; recipient CSV download returned `200` and contained the CSV header and Gemini history; a second Gemini call while `pending_deletion` returned `200`; a non-recipient confirm returned `403 {error:"Only the assigned deletion recipient can confirm",code:"FORBIDDEN"}`; recipient confirmation returned `200 {deleted:true}`. Database verification found `0` agent, usage event, agent task, optimization rule, approval, agent budget, and deletion-row records, with exactly `1` `agent_deleted` audit record containing only deletion metadata and the prior approval fact. Temporary records and export were removed. **Day 5 is complete.**

- **Super Admin bootstrap (Day 2)**: System-level administrators live in the separate `super_admins` table. The first must be created by the platform operator with `npm run bootstrap:superadmin -- <email> <password>`; public signup cannot create one. Login and 2FA now resolve both tenant users and Super Admins, issuing Super Admin sessions with `org_id: null`. Super Admin add/remove routes, including the 3-admin cap and last-admin guard, are deferred work.
- **RBAC middleware (Day 2)**: Session-token authentication attaches typed user context. `requireRole` has explicit role lists with no Super Admin bypass; org scope checks and team/agent access helpers enforce tenant and exact-team-lead boundaries. Proof routes are `GET /admin/orgs` (Super Admin only) and `GET /teams/:teamId` (Org Admin or explicitly assigned Team Lead). Manual operations can add a second/third Super Admin with `npm run add:superadmin -- <email> <password>`; the script enforces the cap of three.
- **Agent authentication (Day 2)**: `X-Agent-Key` authentication now permits only active and pending-deletion agents; pending-approval and paused agents are rejected. `GET /agent-test/ping` is a temporary proof route and must be removed when Day 3 proxy routes provide equivalent coverage.
- **Day 2 status**: Tenant and Super Admin password/2FA authentication, RBAC, and agent API-key authentication are complete. Day 3 can begin proxy and provider-forwarding work.
- **Open auth gap (Day 2)**: `users` has no individual account-status/blocked column. Login currently enforces organization blocking only; individual account blocking is deferred to the future access-control module.

1. **Fastify** - Lightweight, TypeScript-friendly HTTP framework
2. **PostgreSQL + Drizzle** - Type-safe ORM with migrations
3. **Redis + BullMQ** - Job queue for background tasks (daily rollups, alerts)
4. **JWT + bcrypt** - Standard auth stack
5. **Zod** - Runtime schema validation
6. **Pino** - Fast JSON logging
7. **Docker Compose** - Local dev stack (no manual db setup)

---

## Development Workflow

### Daily Updates

- Add to this log at end of each day
- Track completed tasks, blockers, schema changes
- Update "Tomorrow" section for next day priorities

### Module Tracking

- **Module 1** (Day 1): Schema + Authentication
- **Module 2** (Day 2-3): Proxy + LLM Integration
- **Module 3** (Day 3-4): Semantic Cache + Optimization
- **Module 4** (Day 4): Budget + Alerts + Analytics

### Testing

- Unit tests go in `tests/unit/`
- Integration tests go in `tests/integration/`
- Run with `npm test`

---

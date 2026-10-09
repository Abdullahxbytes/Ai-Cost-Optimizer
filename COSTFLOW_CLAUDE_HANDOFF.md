# CostFlow — current project handoff

Prepared 2026-09-18 from the current local source and project history.

## Read this first

This is a handoff, not a claim of production readiness. “Implemented” below means code exists, not that every path has been independently verified against production services. Current source takes precedence over older README/CONTEXT_LOG entries, which describe earlier versions too.

The owner wants Claude to understand the existing product before starting customer-readiness improvements. Those improvements are recommendations, not already completed work. Do not begin a broad rewrite or deployment simply because it appears in this document.

The working tree contains substantial pre-existing modified and untracked files. Preserve them. No application code was changed while preparing this handoff. No credentials, production environment values, or customer data are included here.

## 1. Product and positioning

The public product name is **CostFlow**. Some internal names remain `ai-cost-optimizer` / `ai_cost_optimizer`; these are legacy package/repository identifiers.

CostFlow is a multi-tenant control and visibility layer for LLM API traffic. External customer agents call its proxy; CostFlow authenticates the agent, applies spending controls, optionally reuses cached responses or changes prompt text, forwards to a provider using the organization's key, and records usage for reporting.

It does not itself host or execute autonomous agents. An “agent” in this application is a registered client identity with an owner, team, credential, lifecycle, and settings. It is not currently a general intelligent model-routing engine.

The preferred early market is AI-first startups and mid-market SaaS companies with meaningful API spending. The owner previously suggested $15K–$100K/month as an early segment. That is a targeting hypothesis, not verified traction. There is no customer revenue, retention, or independently validated savings evidence established by this handoff. Landing-page screenshots include illustrative/dummy data and must not be used as customer proof.

An individual/personal workspace is proposed, not implemented as a separate onboarding flow.

## 2. Technical architecture

| Area | Current implementation |
| --- | --- |
| Backend | Node.js, TypeScript, Fastify 5; CommonJS build |
| Database | PostgreSQL, Drizzle ORM, pgvector for semantic similarity |
| Redis | Budget counters and locks, rate limits, kill-switch state |
| Frontend | React 19, TypeScript, Vite, React Router |
| Client state/data | Zustand authentication store; TanStack React Query |
| UI | Tailwind plus shared CSS; Recharts; Phosphor icons |
| Typography | Geist Variable for shared sans text; Outfit Variable display token |
| Auth | Password hashing, JWT sessions, TOTP two-factor authentication; separate agent keys |
| Providers | OpenAI, Anthropic, Gemini adapters and organization BYOK |
| Autocorrection | `nspell` with Hunspell-compatible `dictionary-en`; not a native Hunspell executable |
| Tests | Jest, Supertest, isolated real PostgreSQL/Redis with mocked provider boundaries in relevant suites |
| Deployment assets | Docker, frontend nginx, Terraform AWS infrastructure, PowerShell direct-upload helper |

Backend pattern: `routes -> controller -> service -> repository`, grouped under `src/features/`. Database schemas live with features; `src/db/schema.ts` is the central Drizzle entry point. Registration is centralized in `src/features/features.routes.ts`.

BullMQ is a dependency, but that alone does not mean a durable recurring worker system is implemented.

## 3. Roles and actual frontend surfaces

| Role | Current main navigation |
| --- | --- |
| `super_admin` | System health, organization management, super-admin management |
| `org_admin` | Dashboard, teams, agents, budgets, alerts, users, provider keys, pricing, audit log |
| `team_lead` | Dashboard, agents, budgets, alerts, analytics |
| `developer` | My Agents, My Budget Requests, notifications |
| `finance` | Cost Overview (analytics), Budget Alerts (notifications) |
| `auditor` | Audit log |

Profile and notification routes are shared. The frontend permits Org Admin analytics routes even though analytics is not presently an Org Admin navigation item. Some analytics backend endpoints also allow developers, but there is no developer analytics page in the current route gates. Do not equate API access with navigation visibility.

Access is based on role plus organization/team/ownership checks. Team lead access is scoped to assigned teams; developer agent lists are owner-scoped. Do not assume parent-team membership implies recursive sub-team access. Separate super-admin identities and organization support/access-grant structures exist.

Source of truth: `frontend/src/config/navigation.ts`, `frontend/src/App.tsx`, backend route guards, `src/middleware/rbac.ts`, and service-level scope checks.

## 4. Principal workflows

### Account and organization onboarding

1. Public signup creates an organization and initial Org Admin.
2. Login validates credentials and enters the pending two-factor flow.
3. First login sets up TOTP; verification produces a session.
4. The authenticated UI redirects to the role's default route.
5. Org Admin manages users, teams, memberships, provider keys, rates, and budgets.

Password change, session invalidation, role changes/removal, user reactivation, and last-administrator safeguards have implementations/tests. Treat the account-creation UI as the current invitation behavior; do not assume a complete emailed invitation/reset-password product unless verified separately.

### Team and agent onboarding

1. Org Admin creates teams and assigns a lead; team membership records determine developer team availability.
2. A Developer registers an agent for a team.
3. Registration returns an `agt_...` agent credential; authentication uses a hash stored in the database.
4. The agent enters pending approval. An authorized Team Lead/Org Admin approves or rejects it.
5. The external client sends requests using `X-Agent-Key` after activation.
6. Authorized users can pause/resume agents and manage per-agent optimization settings.

The provider secret is not the agent credential. The organization owns provider credentials; the agent key identifies the calling client to CostFlow.

### Provider-key and model selection

- Org Admin can add/replace/delete organization keys for OpenAI, Anthropic, and Gemini.
- Provider verification logic runs when saving; storage uses AES-256-GCM derived from `PROVIDER_KEY_ENCRYPTION_SECRET`.
- Proxy provider is selected by the request URL; model comes from the provider request body or path.
- On a cache miss, CostFlow looks up that organization's stored key for the selected provider.
- There is no demonstrated per-agent provider-secret assignment or automatic cheapest-model selection.
- Internal cache embeddings use configured Gemini credentials/model, separately from generation BYOK. This needs disclosure and accounting improvements.

Changing the encryption secret without a migration will make existing stored provider keys unreadable. Do not casually rotate it in place.

### Proxy request path

Endpoint: `POST /proxy/:provider/*`.

```text
External client with X-Agent-Key
  -> agent / organization / team status authentication
  -> Redis agent kill-switch check
  -> applicable agent, team, organization budget locks and spend checks
  -> per-agent rate limit
  -> semantic-cache lookup if enabled
       hit: replay cached provider JSON; asynchronously record cache usage
       miss: optional prompt transformation
             -> organization BYOK lookup
             -> provider adapter with timeout/retries
             -> await successful usage recording and budget counters
             -> asynchronously populate semantic cache
  -> return provider-shaped response
```

Optional headers include `X-Task-Id` and `X-Environment` (`dev`, `staging`, `prod`). Without a supplied task ID, a UUID is generated. Public proxy requests containing `X-Is-Test` are rejected; test-mode behavior is no longer client-selectable.

Budget checks occur before cache lookup, so exhausted budgets can reject a request even if it might have been served from cache. Cache hits do not require a generation-provider key lookup in the current flow.

Known error categories include missing provider key, rate limit, budget exceeded, budget enforcement busy, and provider failure. Historic 502/503 reports are debugging history, not proof that every old issue remains reproducible today.

### Budgets and requests

- Organization, team, and agent scopes; daily/monthly periods with timezone-aware reset keys.
- Create, list, update limit, and delete implementations exist.
- Org Admin owns direct editing/deletion; Team Lead/Developer can request an increase where authorized; Org Admin approves/rejects.
- Daily minimum is `$0.00001`.
- Creation/direct-update paths require a limit strictly greater than current period spend.
- Agent allocations have transactional team-ceiling checks.
- Current spend is reflected in cards, progress bars, and request options.

Do not assume all decision paths have identical validation: recheck increase approval, concurrent updates, and period changes when hardening this module.

### Alerts, notifications, and audit

- Alert definitions, threshold updates, enable/disable, history, and acknowledgment exist.
- The application starts a budget-alert scan on readiness and repeats every 60 seconds.
- Scanner currently selects active **budget** alerts, checks Redis spending, records triggered history, and creates in-app notifications.
- Open/unacknowledged history acts as a deduplication gate. Review behavior across budget resets and multiple replicas.
- Spike/runaway definitions do not establish that corresponding detectors run; the inspected scanner only evaluates budget alerts.
- Notifications support ownership-scoped retrieval and read state.
- Audit recording exists across many mutations, including budget and pricing changes, agent lifecycle, and user/team actions. Comprehensive “every mutation is audited” coverage has not been proven; audit completeness remains a review item.

### Deletion workflows

- Agent deletion includes usage export, pending-deletion state, recipient-only download/confirmation, related-data cleanup, and retained deletion audit facts.
- Teams support immediate purge or 15-day archive/retention.
- Archive pauses direct agents and removes ordinary Team Lead/Developer access; retained exports are available to authorized roles.
- Direct sub-teams are reparented to top-level rather than automatically removed with the parent.
- Expired team archives have a cleanup function/manual command; recurring execution is not wired in the inspected application.
- Do not test destructive flows against real data. Reconfirm desired lifecycle policy with the owner before changing retention semantics.

## 5. Optimization and analytics actually implemented

### Semantic response cache

- Per-agent enable flag, similarity threshold, TTL.
- Defaults: disabled, threshold `0.92`, TTL 3600 seconds.
- Gemini embeddings at 768 dimensions; pgvector cosine nearest-neighbor query.
- Lookup filters organization, agent, and expiry.
- Stores prompt text and JSON-serialized provider response; refreshes selected response identity/time fields on replay.
- Embedding/lookup failures fall through to generation; cache-write failures are logged.

### Prompt transformation

- Enabled separately from semantic caching; default off.
- Hunspell-compatible English spelling correction, whitespace normalization, adjacent duplicate-sentence removal.
- Autocorrect contains protections for some identifiers, acronyms, URLs, and ambiguous suggestions. These are heuristics, not proof that all code or domain-specific content is protected.
- Estimated original/optimized tokens use approximately `ceil(characters / 4)`.
- This is not semantic compression, a trained optimization model, or quality-aware routing.

### Usage and analytics

- Usage events include provider/model, agent, task, environment, tokens, calculated USD cost, latency, cache/test state, and optimization counts.
- Pricing supports organization overrides and global fallback, input/output rates per 1,000 tokens, effective dates, editing/deletion, and change history.
- Reports include time series, provider/model breakdowns, token summaries, per-agent metrics, cache hit rate, token reduction, estimated savings, cost-per-task, and price-based provider comparison/simulation.
- Provider-switch simulation is a pricing comparison, not evidence of equal model quality or automatic routing.
- Shared money formatting supports up to five decimals rather than always rounding small amounts to cents.

## 6. UI state and owner preferences

Implemented visual foundations include warm cream surfaces, dark sidebar, burnt-orange actions, shared typography/tokens, Phosphor icons, improved tables/forms, budget cards, and chart styling shared with analytics.

Navigation work includes collapsible desktop icon sidebar and mobile slide-out navigation. Interaction work includes restrained transitions and reduced-motion handling. Verify actual behavior in-browser at desktop and split-window widths before declaring visual work complete.

Owner requirements:

- Apply shared improvements across **all roles**, not just Org Admin Dashboard.
- Preserve desktop multitasking; the earlier blanket 1024px dashboard blocker was rejected.
- Sidebar collapsing must not jitter; collapsed profile menus must remain usable.
- Modal backdrop must cover the whole application viewport without a top gap.
- Landing-page Login should route authenticated sessions to the appropriate app without another login; an extra “Open dashboard” CTA was unwanted.
- Avoid spaghetti code and duplicated role-specific fixes.
- Keep CostFlow branding; Cabinet font was rejected.

Landing page currently has hero/product storytelling work and screenshot assets. The owner rejected some compositions and requested a revert. Treat the current source as a draft rather than an approved final design. Privacy/Terms routes exist, but their text is explicitly placeholder content, not finished policies.

## 7. Deployment and verification status

Infrastructure definitions exist for AWS VPC/subnets/security groups, EC2 plus Elastic IP, RDS PostgreSQL, and ElastiCache Redis. Docker production configuration runs backend plus nginx frontend; database/Redis are external to that compose file. Direct upload from this device is supported by `scripts/deploy-ec2.ps1`; GitHub deployment is not required by the owner.

The production compose file references `.env`; inspect the deployment helper/guide for environment-file placement rather than assuming `.env.production` is loaded automatically. Never paste actual environment contents or Terraform plan/state into a shared handoff.

This review did not verify a live AWS deployment, TLS/domain setup, backups, production secrets, migrations, or production health. Terraform files are not evidence of successful deployment.

Automated tests exist under `tests/auth`, `tests/rbac`, `tests/budgets`, and `tests/deletion`. Historical CONTEXT_LOG reports 22 suites / 82 tests passing on 2026-09-02. That is a historical result, not a fresh result for this working tree.

During this handoff, backend/frontend no-emit typechecks were attempted but could not start because Node hit sandbox `EPERM` resolving `C:\Users\INDUS`. No compiler result or fresh test pass is claimed. Full integration tests were not run.

Tests are destructive to their configured test stores: setup pushes the schema, truncates tables, and flushes test Redis. Verify isolated `TEST_DATABASE_URL` and `TEST_REDIS_URL` before running. Never point them at development/production customer data.

Useful commands (review environment first):

```powershell
# Backend, repository root
npm run dev
npm run build
npm test -- --runInBand

# Frontend
cd frontend
npm run dev
npm run build
```

Database push, seeds, migration utilities, Terraform apply, deletion scripts, and deployment commands mutate state; do not run them as routine read-only checks.

## 8. Confirmed gaps and next audit targets

### Confirmed from current source

1. Cache match partitioning lacks explicit provider/model/settings/end-user context; safe eligibility and invalidation need redesign before broad production use.
2. Prompt transformations lack demonstrated workload-specific quality preservation; token reductions are estimates.
3. Cache-hit latency is recorded as zero; embedding costs are not represented as a complete net-savings ledger.
4. Prompt savings use currently effective rates, not immutable historical request-rate snapshots.
5. Missing pricing/usage can produce zero-cost/zero-token records. Missing model can skip successful usage recording. These are accounting gaps, not free calls.
6. Successful usage logging catches failures and warns rather than guaranteeing durable reconciliation; cache/failure logging and cache writes use background promises.
7. Budget “reservation” currently means shared Redis locks plus a current-spend check, not reservation of predicted maximum request cost. Locks can span provider work; wait deadline is 5 seconds and lease 120 seconds. This creates contention and does not guarantee zero overshoot.
8. Public `X-Is-Test` requests are rejected; no client-controlled budget bypass remains.
9. Agent authentication permits only the `active` state, so pending approval, paused, and pending deletion agents cannot forward requests.
10. Budget alerts have an in-process timer, not a distributed worker scheduler. Cache cleanup and archived-team cleanup remain unwired recurring jobs; `dailyRollup` and `forecastUpdate` are empty functions. No deletion-reminder scheduler was found.
11. CORS is allowlisted through `CORS_ORIGINS`; trusted proxy hops are explicit through `TRUST_PROXY_HOPS`.
12. Privacy and Terms are placeholder pages.

### Needs a targeted audit, not an assertion of absence

- Stage 1 added CSV formula neutralization, route UUID validation, and bounded/rate-limited analytics. Stage 2 added structured log redaction and sanitized provider errors.
- TOTP replay prevention and secret storage protection.
- Every mutation's audit coverage and authorization, including optimization settings.
- Streaming/tool/multimodal compatibility and billing accuracy.
- Retry duplication, durable usage events, lock cleanup on all early-return paths, counter restoration after Redis loss.
- Cross-tenant and within-agent end-user isolation; cache freshness and model changes.
- Actual live OpenAI/Anthropic BYOK generation/verification: code/tests exist, but genuine live success was not established in this review. Gemini has historical live tests; model availability must be rechecked when testing.
- Deployment reliability, restore procedures, HTTPS, retention/deletion guarantees, production secret management.

## 9. Proposed next phase — not implemented yet

The agreed discussion direction is customer trust and measurable value before more cosmetic work:

1. Make cache reuse and prompt transformations safe for a clearly defined workload.
2. Separate actual spend, estimated avoided spend, and net savings; record historical rates and overhead without double counting.
3. Harden budget concurrency, failure semantics, telemetry, and durable accounting.
4. Complete a focused security/privacy/operations review and publish only accurate claims.
5. Offer low-risk onboarding: connect key -> test request -> unoptimized baseline -> controlled optimization -> compare outcomes -> expand.
6. Run a few narrow design-partner pilots measuring cost per successful task, quality, latency, errors, net savings, retention, and willingness to pay. Compare against customers' existing provider-native caching, not an artificially expensive baseline.
7. Add personal-workspace onboarding on the same tenant backend: one owner/default project, no self-approval, simpler navigation, later invite teammates. No separate codebase. Validate spend and willingness to pay rather than assuming individual agent usage is the larger market.

These are recommendations awaiting scoped implementation. Do not advertise verified savings, enterprise readiness, or certification based on demo charts.

## 10. Where Claude should start

- `src/features/proxy/proxy.service.ts`, `proxy.controller.ts`, and `providers/`: request lifecycle/accounting.
- `src/features/optimization/`: settings, semantic cache, savings estimates.
- `src/features/proxy/prompt-autocorrect.service.ts`: spelling logic.
- `src/features/budgets/`, `src/jobs/alertScanner.ts`, `src/app.ts`: enforcement and alerts.
- `src/middleware/`: authentication and access scope.
- `src/features/provider-keys/`: key verification and encryption.
- `src/features/analytics/`, `pricing/`, `audit/`: reporting and business records.
- `frontend/src/config/navigation.ts`, `App.tsx`, `components/Layout.tsx`: role experience.
- `frontend/src/app.css`, `lib/`, `pages/Analytics.tsx`, `pages/Dashboard.tsx`: shared presentation.
- `tests/README.md`: destructive test-environment rules.
- `CONTEXT_LOG.md`: historical decisions/results, not a substitute for inspecting current code.
- `DEPLOYMENT_GUIDE.md`, `terraform/`, compose files, deployment helper: intended deployment.

Suggested instruction to Claude: “Read this handoff and inspect the current working tree. First identify discrepancies and propose a small, prioritized implementation plan for customer readiness. Preserve existing work and role behavior. Do not deploy, run destructive tests, rotate secrets, or start broad rewrites without a scoped request. Distinguish source inspection, automated test results, live verification, and assumptions.”

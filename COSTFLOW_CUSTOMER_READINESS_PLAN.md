# CostFlow customer-readiness development plan

Status: finalized planning baseline, 2026-09-18. This document authorizes no deployment or data migration by itself. Implement in reviewable increments against the current working tree.

## Goal and scope

Make CostFlow safe enough for a limited real-customer pilot, then prove that it lowers **cost per successful task** without unacceptable quality, latency, or reliability loss. Expand to general customer availability only after billing, operations, privacy, and recovery are demonstrated. Personal onboarding is a later distribution feature; it is not a prerequisite for a business pilot.

Use the existing Fastify/React/Drizzle/PostgreSQL/Redis architecture and role scopes. Preserve user changes. Inspect the current code before choosing files or migrations; examples in an earlier draft named tables that do not exist. Current relevant tables include `orgs`, `semantic_cache`, and `usage_events`. Existing provider-key verification and the in-process 60-second budget-alert scanner should be improved or moved, not duplicated.

Each module below must include tests for its actual risk, a migration/rollback approach if data changes, and observable failure behavior. Do not infer production readiness from code compilation or a passing mocked test alone.

## Improvement 1 — Security and authorization

**Build:** Close paths that could bypass spending controls or expose one customer's data to another. Harden authentication and exported data.

### 1.1 Agent, request, and export controls

- Remove client-controlled `X-Is-Test` budget bypass from production traffic. If test traffic remains, authorize it with a separate internal identity and hard limits; never trust the header alone.
- Explicitly allow only `active` agents through agent authentication, including rejection of `pending_deletion`.
- Validate route IDs and bounded analytics query ranges at the route boundary. Apply sensible endpoint-specific rate limits.
- Neutralize spreadsheet formulas in every CSV export, including agent and archived-team exports; keep ordinary CSV quoting.
- Test cross-organization/role access and forbidden states through real routes.

**Done when:** An ordinary agent cannot bypass budgets, invalid IDs and unauthorized scopes are rejected, pending-deletion agents cannot call the proxy, and exported user-controlled values cannot execute spreadsheet formulas.

### 1.2 Account and deployment boundary

- Record the accepted TOTP time step per account and atomically reject reuse, including adjacent time steps accepted for clock drift. Apply to tenant and super-admin accounts.
- Review protection of TOTP secrets and provider-key encryption secrets, including backup and rotation procedures.
- Set CORS origins and `trustProxy` from the actual deployment topology. Do not treat CORS as API authorization.
- Redact credentials, prompt bodies, and sensitive provider errors from routine logs; verify with tests.

**Done when:** A previously accepted TOTP cannot be reused, trusted proxy and origin behavior is tested for the intended topology, and sensitive values do not appear in application logs.

## Improvement 2 — Cache safety

**Build:** Reuse responses only when request context and data freshness make that reuse safe. Start with exact-request caching; enable semantic reuse for explicitly approved workloads.

### 2.1 Eligibility policy and schema design

**Stage 1 implementation (2026-10-07):** Policy API, versioned identity and
eligibility modules, V2 schema, additive migration and regression tests are
implemented. See [Cache safety](docs/CACHE_SAFETY.md). Legacy response caching is
paused; Stage 2 runtime and workload quality validation are not complete. The
application database migration must be applied explicitly before policy API use.

- Select the first supported workload and list eligible/ineligible request forms. Exclude dynamic, personal, state-changing, tool-executing, and other unsafe requests unless a specific rule proves them safe.
- Define cache identity using organization, agent, authenticated or server-verified end-user scope where applicable, provider, model, full relevant request context, generation settings, and a workload/knowledge version.
- Specify exact-match keys, semantic matching scope, TTL, explicit invalidation, and behavior after a model, prompt, settings, or knowledge change.
- Audit existing stored entries and plan safe migration or expiry; never reinterpret old rows under broader rules.

**Done when:** The eligibility document and tests cover differences in model, system prompt, generation settings, user scope, conversation state, and knowledge version.

### 2.2 Enforcement and observability

- Enforce eligibility in the existing optimization/proxy service, with Drizzle schema changes following current feature ownership.
- Use exact full-context matches first. Permit semantic matching only inside the approved partition and workload.
- Record actual cache lookup latency and embedding use, and expose cache hit/miss/bypass reasons in request diagnostics.
- Add invalidation and scoped purge controls. Treat incorrect-result detection as an evaluation process, not an automatic guarantee.

**Done when:** Tests show no cross-organization, cross-user, cross-model, or changed-context reuse; expiry and invalidation work; measured cache latency is not reported as zero.

## Improvement 3 — Optimization quality and pilot evidence

**Build:** Test whether optimization preserves the customer's outcomes, then measure its effect using representative traffic.

### 3.1 Workload evaluation

- Obtain a consented, representative dataset for one repeatable workload; size it according to coverage rather than a fixed 100–500 requirement.
- Define task-specific pass/fail checks and human review for ambiguous cases. Record failures, stale/incorrect cache responses, and quality changes after prompt transformation.
- Measure provider latency, proxy overhead, hit/miss latency, and end-to-end task latency separately.
- Establish acceptable thresholds with the design partner before viewing pilot results; avoid using BLEU or embedding similarity as sole success criteria.

**Done when:** The same evaluation can be rerun against baseline and optimized configurations, and a task regression blocks rollout for that workload.

### 3.2 Controlled pilot measurement

- Label baseline and optimized cohorts in durable request records. Define assignment and avoid comparing materially different users, tasks, provider settings, or time periods as if equivalent.
- Compare against the customer's existing provider-native caching and negotiated rates.
- Use the accounting ledger from Improvement 4 to report actual spend, estimated avoided spend, overhead, net savings, latency, and cost per successful task.
- Record exceptions and confidence limits; obtain customer review before turning pilot results into a public claim.

**Done when:** At least one design partner can verify the workload definition, comparison method, quality results, and net-savings report. No fixed savings or latency gain is promised in advance.

## Improvement 4 — Trustworthy accounting

**Build:** Produce a durable record of what happened and how every cost or savings estimate was calculated.

### 4.1 Ledger and historical rate snapshots

- Extend the current `usage_events` model or add linked, immutable cost records only where needed. Use current Drizzle feature schemas and a migration compatible with existing data.
- Record provider/model, token categories, rate source/version/effective time, native cache billing where available, actual provider cost, optimization overhead, and estimate provenance.
- Represent actual charged cost separately from estimated avoided cost and calculated net savings. Prevent double counting between cache and prompt optimization.
- Choose decimal precision that preserves sub-cent events; `DECIMAL(...,2)` is insufficient. Define rounding at report/invoice boundaries.
- Treat missing usage or rates as **unknown/incomplete**, never as a verified free call.

**Done when:** Later rate changes do not alter old events; small costs remain measurable; reports disclose estimated versus known values and never quietly display unknown as zero.

### 4.2 Durable recording and reconciliation

- Replace best-effort usage writes with an idempotent, recoverable event path. Design how provider success is handled if local accounting temporarily fails.
- Deduplicate retries and reconcile request, usage, cache, and budget records.
- Reconcile against the provider usage or bill data actually available to a BYOK customer; record coverage and variance. Do not promise a universal 1% match before confirming provider billing granularity and access.
- Alert on missing rates, missing events, and material discrepancies; provide an investigation view or export.

**Done when:** Crash/retry tests do not silently lose or duplicate billable events, and a pilot customer can trace reported spend back to source usage and pricing assumptions.

## Improvement 5 — Budget enforcement

**Build:** Handle concurrent calls without holding a shared lock through a provider request, while making the limit's guarantees explicit.

### 5.1 Reservation design

- Specify what can be bounded at admission: model, maximum output tokens, estimated input, retry policy, and scope (agent/team/organization).
- Reserve capacity in a short atomic operation using the selected Redis or database mechanism, then release the transaction/lock before calling the provider. Do not lock a database row for the duration of a network request.
- Define actions for unknown maximum cost, streaming, provider failure, timeout, process crash, and stale reservations.
- Reconcile against actual provider usage and return unused reservation capacity promptly.

**Done when:** The design states whether each supported request has a hard bound or a documented potential overshoot. No unproven universal 1% guarantee is advertised.

### 5.2 Implementation and failure testing

- Replace long-lived budget locks with the chosen reservation mechanism and test concurrent requests at agent, team, and organization scopes.
- Test restarts, Redis/database interruption, retries, missing usage, and reconciliation delays; ensure reservations expire safely and recovery runs promptly.
- Preserve alert definitions and trigger thresholds, but ensure an alert is not presented as a substitute for enforcement.
- Record budget rejections, busy conditions, and reservation health for operators.

**Done when:** Load tests at representative traffic show bounded contention and no unexplained stuck reservations. Any permitted overshoot is measured, documented, and agreed before pilots.

## Improvement 6 — Recurring operations

**Build:** Ensure required cleanup and alerts continue across restarts and multiple application instances.

### 6.1 Job runner

- Introduce a durable scheduler/worker using the existing BullMQ dependency if it suits deployment; use stable scheduler IDs, idempotent handlers, retries, failure visibility, and worker health checks.
- Run workers independently of web request handling as appropriate. Establish one source of scheduling truth so multiple web instances do not run duplicate in-process scans.
- Define recovery and alerting for jobs that stop running. Configure retention for completed/failed job metadata.

**Done when:** A restart or second application instance does not lose work or cause duplicate externally visible actions; failed jobs are discoverable and retryable.

### 6.2 Essential scheduled jobs

- Move the existing 60-second budget-alert scanner from the Fastify timer to the durable runner, preserving alert deduplication.
- Schedule cache cleanup based on each entry's `expires_at`.
- Schedule archived-team cleanup frequently enough to honor the existing 15-day retention policy.
- Add deletion reminders only after the intended recipient, timing, and cancellation/retention behavior are defined.
- Add rollups or forecasts only when real reporting requirements call for them; the present placeholder job functions are not proof of a customer need.

**Done when:** The essential three jobs run and can be observed after restart. Any reminder schedule is approved against the actual deletion policy.

## Improvement 7 — Guided business onboarding

**Build:** Let a customer safely connect a provider, establish a baseline, test one optimization, and understand the result.

### 7.1 Connection and baseline

- Reuse existing organization provider-key verification; improve diagnostics and add a clearly marked test request for a supported provider/model.
- Guide agent registration and approval, show the required proxy endpoint/header, and verify a recorded usage event.
- Collect baseline traffic with optimizations disabled while retaining normal authentication and agreed budget controls.
- Display pricing coverage and missing-data warnings before showing savings.

**Done when:** A new pilot customer can send a real request, see its provider/model and recorded cost, and establish a baseline without accidental optimization or a budget bypass.

### 7.2 Comparison and controls

- Present baseline and optimized cohorts with actual spend, estimated avoided spend, overhead, net savings, task success, and latency in their correct units.
- Link optimization toggles to the approved workload and provide quick rollback, diagnostics, and export.
- Describe limits of comparisons in the UI; do not imply causality from unmatched before/after traffic.

**Done when:** A pilot customer can verify what changed, inspect the supporting data, and turn optimization off without disabling normal proxy security or spending controls.

## Improvement 8 — Personal workspace

**Build:** A simpler entry path for solo API developers using the existing tenant model, after the core service is trustworthy.

### 8.1 Existing-tenant backend path

- Represent a personal workspace as an `orgs` tenant with one owner, using a minimal type/owner marker if needed after checking current constraints.
- Create a default workspace/team as needed by the current agent model. Specify whether owner-created agents activate immediately; keep the same key, audit, budget, and isolation rules.
- Design conversion by inviting collaborators without migrating or duplicating usage history.
- Distinguish an API developer with routable traffic from a consumer chatbot subscription user.

**Done when:** A solo owner can create an agent and send a metered request through the existing proxy, then invite teammates without losing data or weakening isolation.

### 8.2 Focused UI

- Ask only for the information needed to connect a provider and make a first request.
- Show relevant personal navigation and hide team administration until collaboration begins.
- Reuse dashboard, budgets, and analytics components where roles permit; avoid a second implementation of core features.
- Test the transition to team use with existing role scopes.

**Done when:** A solo user can reach first verified usage with few steps, and the same workspace remains valid after adding a team.

## Release gates

### Limited design-partner pilot

- Critical authorization, cache-partition, and accounting gaps are closed for the **specified supported workload**.
- Budget semantics and known overshoot limits are documented and tested under representative concurrency.
- Essential alert/cleanup jobs run reliably; operators can detect failures.
- Provider/key compatibility, data handling, logs, retention, rollback, and support contact are explained accurately to the pilot customer.
- Baseline, task-quality measurement, and traceable spend are available. Pilot results are kept private until the customer verifies them.

### Broader customer availability

- Repeated pilots show acceptable task quality, measured net savings, retention, and willingness to pay.
- Production deployment has tested restoration, incident handling, secret management, and provider reconciliation.
- Privacy and Terms pages contain real policies rather than current placeholders; compatibility and support claims match tested behavior.
- Security review and operational monitoring cover all advertised providers/workloads. Personal onboarding is required only if that market is being launched.

## Sequence and estimation

Start with Improvement 1's critical authorization issues, then Improvements 2 and 3.1. Design Improvements 4 and 5 together because budget reservations depend on reliable cost events. Build the recurring runner before the pilot. Complete Improvement 3.2 and Improvement 7 once the ledger can support honest comparisons. Pursue Improvement 8 after the first business pilot unless a validated personal-user opportunity changes the order.

The original six-week total is a hypothesis, not a commitment. Estimate each module after its design and dependencies are checked. Use the pilot gate, not “16 modules completed,” as the measure of readiness to invite real traffic.

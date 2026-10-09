# CostFlow security controls register

Last reviewed: 2026-10-09 (cache Stage 2; earlier controls retained)

## Purpose

This is the canonical internal record of CostFlow's implemented security controls, configuration assumptions, verification coverage, and accepted gaps. Update it in the same change whenever a security-sensitive behavior is added, removed, or materially changed.

This document is not a public vulnerability-disclosure policy, penetration-test report, compliance certification, privacy policy, or substitute for reviewing deployed infrastructure.

## Status vocabulary

- **Implemented:** present in the application code.
- **Tested:** covered by an automated test that exercises the stated boundary.
- **Deployment-required:** the application supports the control, but each environment must provide correct values or infrastructure.
- **Deferred:** known work that is not represented as complete.

## Security boundaries

CostFlow has two authenticated access layers:

1. **User layer:** people using the dashboard as super admins, organization admins, team leads, developers, finance users, or auditors.
2. **Agent layer:** applications sending model requests through the CostFlow proxy using agent keys.

The layers use separate credentials and rate-limit identities. They share organization isolation, budgets, usage accounting, and audit records.

## Implemented controls

### Authentication and session security

| Control | Status | Current behavior |
| --- | --- | --- |
| Password storage | Implemented, tested | Passwords are hashed with bcrypt. Invalid login responses do not disclose whether an account exists. |
| Dashboard sessions | Implemented, tested | Signed JWTs include user, organization, role, and token version. Current account and organization state is revalidated. |
| Session invalidation | Implemented, tested | Password and account-state changes can invalidate existing tokens through token-version checks. |
| Agent credentials | Implemented, tested | Raw agent keys are not stored; lookup uses an HMAC-derived value. Only active agents in active organizations and non-archived teams may use the proxy. |
| TOTP requirement | Implemented, tested | Tenant and super-admin sign-in requires TOTP after password verification. |
| TOTP encryption | Implemented, tested | TOTP secrets use AES-256-GCM at rest. Legacy plaintext secrets are encrypted after successful verification. |
| TOTP replay prevention | Implemented, tested | The accepted TOTP time step is stored atomically; an accepted code cannot be reused, including by concurrent requests. Failed codes are not marked as used. |

### Authorization and tenant isolation

| Control | Status | Current behavior |
| --- | --- | --- |
| Role authorization | Implemented, tested | Routes enforce role requirements for organization administration, teams, agents, budgets, analytics, pricing, provider keys, and audits. |
| Organization scoping | Implemented, tested | Tenant routes verify organization ownership; cross-organization and role-denial tests are present. |
| Agent lifecycle enforcement | Implemented, tested | Pending approval, paused, pending deletion, blocked-organization, and archived-team agents cannot forward provider requests. |
| Public test bypass | Implemented, tested | Public proxy requests containing `X-Is-Test` are rejected; callers cannot bypass budgets by setting a header. |
| Route identifiers | Implemented, tested | Conventional `*Id` route parameters are validated as UUIDs before handlers run. |

### Layered rate limiting

Rate limits are stored in Redis. Normal authenticated traffic is not primarily limited by IP address.

| Boundary | Default | Identity | Purpose |
| --- | ---: | --- | --- |
| Agent proxy | 60/minute | Organization + agent | Normal per-agent fairness. |
| Organization proxy | 3,000/minute | Organization | Prevent creating many agents to multiply capacity. |
| Proxy emergency IP | 10,000/minute | Trusted client IP | High emergency ceiling only; agents sharing an IP retain separate normal allowances. |
| Invalid agent credentials | 30 failures/minute | Trusted client IP | Slow agent-key guessing before a trusted agent identity exists. |
| Dashboard reads | 600/minute | Organization + user | Normal authenticated dashboard traffic. |
| Dashboard writes | 120/minute | Organization + user | Protect state-changing operations. |
| Organization dashboard | 3,000/minute | Organization | Aggregate tenant protection. |
| Analytics | 120/minute | User | Protect database-heavy analytics endpoints. |
| Exports | 10/minute | User | Protect expensive CSV/archive generation. |
| Login account | 5 failures/15 minutes | Hashed normalized email | Stop distributed attacks against one account. |
| Login IP | 30 failures/15 minutes | Hashed trusted client IP | Stop one source attacking many accounts. |
| TOTP account | 5 failures/10 minutes | Pending user | Stop repeated code guessing. |
| TOTP IP | 30 failures/10 minutes | Hashed trusted client IP | Additional abuse protection. |
| Global circuit breaker | 100,000/minute | Deployment | Emergency protection for application dependencies. |

Successful login and TOTP verification do not consume failure allowances. Successful account authentication clears the account failure counter but does not erase shared IP attack history.

Rate-limited responses use HTTP `429`, code `RATE_LIMIT`, a safe `scope`, `retryAfter`, and the `Retry-After` response header.

The IP controls above are intentional secondary safeguards. They are not the normal quota for authenticated agents or users. Do not replace agent/user/organization limits with a low IP-only limit.

### Network and browser boundary

| Control | Status | Current behavior |
| --- | --- | --- |
| CORS allowlist | Implemented, tested, deployment-required | Browser origins are read from `CORS_ORIGINS`; arbitrary origins do not receive browser permission. CORS is not API authentication. |
| Trusted proxy topology | Implemented, deployment-required | `TRUST_PROXY_HOPS` limits which forwarded-client information Fastify trusts. Current Nginx deployment expects one hop; local development expects zero. |
| HTTP response hardening | Implemented | Fastify Helmet supplies security headers. TLS termination and public network controls remain deployment responsibilities. |

### Secrets and logging

| Control | Status | Current behavior |
| --- | --- | --- |
| Provider-key encryption | Implemented | Organization provider keys are encrypted at rest. |
| Separate TOTP key | Supported, deployment-required | Production should set a distinct `TOTP_ENCRYPTION_SECRET`; compatibility fallback to the provider encryption key remains. |
| Structured-log redaction | Implemented, tested | Authorization headers, agent keys, passwords, provider keys, and TOTP values are redacted. |
| Error sanitization | Implemented | Provider, Redis, startup, and request errors avoid logging raw credential-bearing messages and request bodies. |
| Audit-log separation | Implemented | Business audit entries record actors and actions, not passwords, raw API keys, bearer tokens, or TOTP secrets. |

### Input, export, and resource protection

| Control | Status | Current behavior |
| --- | --- | --- |
| CSV formula neutralization | Implemented, tested | User-controlled cells that could execute spreadsheet formulas are neutralized in agent and archived-team exports. |
| Analytics range bounds | Implemented, tested | Analytics date ranges are bounded to prevent unbounded database work. |
| Provider-key verification throttle | Implemented | Provider-key save/verification operations have a strict organization limit. |
| Budget enforcement | Implemented with known redesign work | Agent, team, and organization budgets exist. The reservation/concurrency design is tracked separately under customer-readiness Improvement 5. |

## Required deployment configuration

Every deployment must explicitly review:

- `CORS_ORIGINS`
- `TRUST_PROXY_HOPS`
- `JWT_SECRET`
- `AGENT_KEY_HMAC_SECRET`
- `PROVIDER_KEY_ENCRYPTION_SECRET`
- `TOTP_ENCRYPTION_SECRET`
- `CACHE_CONTEXT_SIGNING_SECRET` when using end-user-scoped caching
- all rate-limit environment values
- TLS termination, firewall/security-group rules, Redis/PostgreSQL exposure, backups, and secret storage

Changing an encryption secret without a migration can make existing encrypted data unreadable. Secrets must be generated securely, stored outside source control, backed up securely, and rotated through a planned migration.

## Verification record

The security implementation is covered by authentication, authorization, cross-organization, deletion-state, budget, and files under `tests/security/`. As of 2026-09-24:

- TypeScript backend build: passed.
- Focused layered-rate-limit suite: 29/29 tests passed.
- Complete backend suite: 102/102 tests across 25 suites passed.

Passing tests demonstrate the tested application behavior; they do not constitute penetration testing or production certification.

Cache Stage 1 verification, 2026-10-07:

- Complete backend suite: 164/164 tests across 29 suites passed, including 62
  cache-focused tests across four new suites.
- Backend TypeScript build and frontend production build passed. Frontend retains
  the existing bundle-size warning; no browser visual review was performed.
- Targeted SQL migration was exercised against an isolated test schema, including
  a repeat application; migration command dry run passed. No application database
  migration or deployment was performed.
- Provider calls were mocked; no paid API calls or production load tests ran.

## Known gaps and deferred work

### Cache foundation update (2026-10-07)

- Stage 1 adds explicit, default-off per-agent cache policies, complete request
  identities, exact/semantic partition rules, response eligibility guards, TTL
  and revision invalidation contracts, and separate V2 tables. See
  [Cache safety](CACHE_SAFETY.md) for implementation, deployment and rollback.
- Existing weakly partitioned cache reads/writes are disabled. The proxy forwards
  to the provider without cache embeddings. Old rows/settings are retained;
  they are not migrated or considered eligible. Prompt optimization remains.
- Policy GET/PUT follows existing org/agent RBAC. Writes and sanitized audit
  records commit atomically. Caller headers cannot activate caching or supply
  trusted end-user authorization through these endpoints.
- Tests in `tests/cache` cover policies, identity boundaries, request/response
  eligibility, expiry, tenant/role access, revisions, migration and legacy bypass.
- Stage 2 runtime wiring, verified user context, purge/cleanup, workload accuracy
  evidence and savings accounting remain unfinished. No production readiness or
  savings claim follows from Stage 1.

### Cache Stage 2 opt-in runtime (2026-10-09)

- The V2 repository, scoped purge, signed end-user context, bounded diagnostics
  endpoint, policy controls and expiry cleanup code are implemented. See
  [Cache Stage 2](CACHE_STAGE_TWO.md).
- The proxy uses V2 exact-first caching only after an authorized owner saves an
  eligible agent policy. Approved semantic workloads use a bounded Gemini
  embedding call with the organization's key; non-Gemini requests additionally
  require cross-provider egress consent. Cache/embedding failures forward to
  the provider. The signing secret must be configured for per-user tokens.
- The V2 migrations were applied only to the backed-up local application
  database. Production migrations, load tests and live paid-provider
  verification remain rollout work; passing mocked tests does not establish
  safe semantic quality or actual net savings.

### Other deferred work

- Rate-limit defaults are global configuration, not yet customer-plan or per-agent overrides.
- Rate-limit metrics, alerting, operator dashboards, and production load calibration remain required before broad availability.
- Redis outage behavior and capacity must be deliberately tested for the deployed topology.
- Edge/WAF/DDoS protection is a deployment-layer responsibility and is not replaced by application counters.
- Secret-manager integration, documented rotation drills, database restoration tests, and incident-response procedures remain deployment work.
- Cache safety, trustworthy accounting, budget reservation hardening, durable jobs, pilot evidence, and onboarding remain separate customer-readiness improvements.
- Privacy and Terms content remains product/legal work, not an application security control.

## Change procedure

Every future security change must update this file in the same pull request or commit:

1. Describe the threat or failure being addressed.
2. Record the implemented control and where it applies.
3. Record configuration and deployment assumptions.
4. Add or update automated tests for the actual boundary.
5. Add known limitations rather than implying complete protection.
6. Update the verification date and results after running the relevant suites.

When behavior and this document disagree, treat the code as the current behavior and the documentation mismatch as a defect that must be corrected.

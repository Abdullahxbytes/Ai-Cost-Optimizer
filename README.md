# CostFlow

CostFlow is a local-first platform for monitoring and controlling AI-agent API
spend. Agents send requests through the proxy; organization users manage agents,
provider keys, budgets, alerts, and analytics in the dashboard. Response caching
is off until an authorized owner configures an eligible per-agent policy.

## Run locally

Requires Node.js, npm, and Docker for PostgreSQL and Redis. The Compose file
starts **only** those two development dependencies; run the API and frontend
with npm.

```powershell
Copy-Item .env.example .env
docker compose up -d postgres redis
npm install
npm run db:push  # for a new local database only
npm run dev
```

In another terminal:

```powershell
cd frontend
npm install
npm run dev
```

Keep real secrets in `.env`, not Git. For an existing database, review and apply
the additive cache migrations described in
[Cache Stage 2](docs/CACHE_STAGE_TWO.md); do not blindly push a schema over
customer data.

## Checks

```powershell
npm run format:check
npm run build
npm test -- --runInBand
cd frontend
npm run build
```

The test suite uses a separate PostgreSQL database and Redis DB 1. Read
[tests/README.md](tests/README.md) before running it. External provider calls
are mocked in automated tests, so passing tests do not establish live-provider
compatibility or net savings.

## Technical notes

- [Cache policy and eligibility](docs/CACHE_SAFETY.md)
- [Cache runtime and local migration](docs/CACHE_STAGE_TWO.md)
- [Implemented security controls and known gaps](docs/SECURITY_CONTROLS.md)
- [Customer-readiness plan](COSTFLOW_CUSTOMER_READINESS_PLAN.md)

# Test infrastructure

Jest uses a dedicated PostgreSQL database and Redis database index so it never touches development data:

- `TEST_DATABASE_URL` (default local value: `postgres://user:password@localhost:5432/ai_cost_optimizer_test`)
- `TEST_REDIS_URL` (default local value: `redis://localhost:6379/1`)

Copy `.env.test.example` into your shell or CI secret store. `globalSetup` creates the test database if needed and runs `drizzle-kit push --force` against it. Jest is deliberately single-worker; after every test it truncates every public-table row and flushes Redis DB 1. Tests are therefore independent and must never point `TEST_DATABASE_URL` at `ai_cost_optimizer` or use Redis DB 0.

Run the suite with `npm test`.

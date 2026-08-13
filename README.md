# AI Cost Optimizer

A multi-tenant platform for monitoring, controlling, and optimizing LLM API costs with semantic caching, budget management, and real-time alerts.

## Quick Start

### Prerequisites
- Node.js 18+
- Docker & Docker Compose
- npm

### Setup

1. **Clone and install dependencies:**
   ```bash
   npm install
   ```

2. **Copy environment file:**
   ```bash
   cp .env.example .env
   ```

3. **Start PostgreSQL and Redis:**
   ```bash
   npm run docker:up
   ```

4. **Start development server:**
   ```bash
   npm run dev
   ```

The server will start at `http://localhost:3000`

### Verify Installation

```bash
curl http://localhost:3000/health
```

Should return:
```json
{"status":"ok","timestamp":"2024-..."}
```

## Available Scripts

- `npm run dev` - Start development server with hot-reload
- `npm run build` - Build TypeScript to JavaScript
- `npm start` - Run compiled JavaScript
- `npm test` - Run unit and integration tests
- `npm run test:watch` - Run tests in watch mode
- `npm run test:cov` - Generate coverage report
- `npm run lint` - Run ESLint and fix issues
- `npm run format` - Format code with Prettier
- `npm run db:push` - Push Drizzle schema to database
- `npm run db:studio` - Open Drizzle Studio (database UI)
- `npm run seed` - Seed database with test data
- `npm run docker:up` - Start PostgreSQL and Redis containers
- `npm run docker:down` - Stop Docker containers

## Project Structure

```
src/
├── config/         - Configuration (database, Redis, env)
├── middleware/     - Fastify middleware (auth, error handling, rate limiting)
├── routes/         - API endpoint handlers
├── services/       - Business logic (auth, cost calculation, cache, etc.)
├── jobs/          - Background jobs (rollups, alerts, cleanup)
├── schemas/       - Drizzle ORM table definitions
├── utils/         - Helpers (logger, validators, errors)
└── app.ts         - Fastify application bootstrap

tests/             - Unit and integration tests
scripts/           - Database seeding and migrations
docker-compose.yml - Local development stack (PostgreSQL + Redis)
```

## Development Workflow

### Day-by-Day Progress

See [CONTEXT_LOG.md](CONTEXT_LOG.md) for detailed daily updates and completed tasks.

### Architecture

- **Framework**: Fastify (lightweight HTTP server)
- **Database**: PostgreSQL + Drizzle ORM
- **Cache**: Redis + BullMQ for job queues
- **Auth**: JWT + bcrypt
- **Validation**: Zod for schema validation
- **Logging**: Pino

## Environment Variables

See `.env.example` for all configuration options.

**Critical for local development:**
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `JWT_SECRET` - Secret key for JWT signing (use a strong value in production)
- `PORT` - Server port (default: 3000)

## Database Migrations

This project uses Drizzle ORM. To manage database schema:

```bash
npm run db:push      # Push schema changes to database
npm run db:studio    # Open web UI to view/edit data
```

## Testing

```bash
npm test             # Run all tests
npm run test:watch   # Watch mode
npm run test:cov     # Coverage report
```

## Troubleshooting

### PostgreSQL connection failed
```bash
npm run docker:up
# Wait for health checks to pass (check Docker logs)
```

### Redis connection failed
```bash
docker-compose logs redis
# Ensure redis service is healthy
```

### Port 3000 already in use
```bash
# Set PORT environment variable
PORT=3001 npm run dev
```

## Next Steps

1. Day 1: Drizzle schema design (users, orgs, teams, agents, budgets)
2. Week 1: Core authentication and org management
3. Week 2: LLM proxy endpoints and semantic caching
4. Week 3: Budget enforcement and alerting

See [CONTEXT_LOG.md](CONTEXT_LOG.md) for full roadmap.

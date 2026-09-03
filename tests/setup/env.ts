import 'dotenv/config';

const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? 'postgres://user:password@localhost:5432/ai_cost_optimizer_test';
if (testDatabaseUrl.includes('/ai_cost_optimizer?') || testDatabaseUrl.endsWith('/ai_cost_optimizer')) {
  throw new Error('TEST_DATABASE_URL must point to a dedicated test database, never ai_cost_optimizer');
}
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testDatabaseUrl;
// Use IPv4 loopback for the Docker-published test Redis port. This avoids
// intermittent Windows localhost/IPv6 resolution timeouts in Jest workers.
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/1';
process.env.JWT_SECRET ??= 'test-jwt-secret-that-is-at-least-thirty-two-characters-long';
process.env.AGENT_KEY_HMAC_SECRET ??= 'test-agent-hmac-secret-that-is-at-least-thirty-two-characters-long';
process.env.PROVIDER_KEY_ENCRYPTION_SECRET ??= 'test-provider-encryption-secret-at-least-thirty-two-characters';
process.env.LOG_LEVEL = 'error';

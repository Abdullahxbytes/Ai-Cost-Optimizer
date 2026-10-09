import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  JWT_SECRET: z.string().min(32),
  AGENT_KEY_HMAC_SECRET: z.string().min(32),
  PROVIDER_KEY_ENCRYPTION_SECRET: z.string().min(32),
  TOTP_ENCRYPTION_SECRET: z.string().min(32).optional(),
  CACHE_CONTEXT_SIGNING_SECRET: z.string().min(32).optional(),
  JWT_EXPIRES_IN: z.string().default('7d'),
  GEMINI_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  EMBEDDING_API_KEY: z.string().optional(),
  EMBEDDING_MODEL: z.string().default('gemini-embedding-001'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  PLATFORM_URL: z.string().url().default('http://localhost:3000'),
  CORS_ORIGINS: z.string().optional(),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  AGENT_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),
  ORG_PROXY_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(3000),
  PROXY_IP_EMERGENCY_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10000),
  GLOBAL_API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(100000),
  USER_READ_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(600),
  USER_WRITE_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(120),
  ORG_DASHBOARD_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(3000),
});
const parsed = envSchema.parse(process.env);
export const env = {
  ...parsed,
  // Backward-compatible fallback keeps existing installations readable. New
  // deployments should configure an independent TOTP encryption secret.
  TOTP_ENCRYPTION_SECRET: parsed.TOTP_ENCRYPTION_SECRET ?? parsed.PROVIDER_KEY_ENCRYPTION_SECRET,
};

const configuredCorsOrigins = env.CORS_ORIGINS?.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export const corsOrigins = configuredCorsOrigins?.length
  ? configuredCorsOrigins
  : env.NODE_ENV === 'development'
    ? ['http://localhost:5173']
    : [new URL(env.PLATFORM_URL).origin];

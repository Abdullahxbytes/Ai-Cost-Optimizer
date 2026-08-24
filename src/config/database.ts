import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from './env';
const client = postgres(env.DATABASE_URL);
// Do not log SQL parameter values: queries can contain password hashes and TOTP secrets.
export const db = drizzle(client);
export { client };

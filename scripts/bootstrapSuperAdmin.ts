import 'dotenv/config';
import bcrypt from 'bcrypt';
import { count } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { superAdmins } from '../src/db/schema';

const [, , emailArg, passwordArg] = process.argv;
if (!emailArg || !passwordArg) {
  throw new Error('Usage: npm run bootstrap:superadmin -- <email> <password>');
}
if (passwordArg.length < 8) throw new Error('Password must be at least 8 characters');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client);

async function bootstrap() {
  const [{ total }] = await db.select({ total: count() }).from(superAdmins);
  if (total > 0) throw new Error('Bootstrap refused: a Super Admin already exists');

  const passwordHash = await bcrypt.hash(passwordArg, 12);
  const [admin] = await db
    .insert(superAdmins)
    .values({
      email: emailArg.trim().toLowerCase(),
      passwordHash,
      createdBy: null,
    })
    .returning({ id: superAdmins.id, email: superAdmins.email });
  console.log(`Bootstrapped Super Admin ${admin.email} (${admin.id})`);
}

bootstrap().finally(() => client.end());

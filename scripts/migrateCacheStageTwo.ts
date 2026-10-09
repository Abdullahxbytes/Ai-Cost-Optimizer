import 'dotenv/config';
import { readFileSync } from 'fs';
import path from 'path';
import postgres from 'postgres';

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--apply')) throw new Error('Only --apply is supported');
  if (!args.includes('--apply')) {
    console.log(
      'Dry run: add the V2 unique exact-key index and cache_request_diagnostics table. No existing rows will be modified. Verify the target and back it up before --apply.'
    );
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const client = postgres(process.env.DATABASE_URL, { max: 1 });
  try {
    const migration = readFileSync(
      path.resolve(__dirname, '../migrations/cache-stage-two.sql'),
      'utf8'
    );
    await client.begin(async (tx) => {
      await tx`SET LOCAL lock_timeout = '5s'`;
      await tx`SET LOCAL statement_timeout = '30s'`;
      await tx.unsafe(migration);
    });
    console.log('Cache Stage 2 exact-key index and diagnostics table applied.');
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error(
    'Cache Stage 2 migration failed; transaction rolled back.',
    error instanceof Error ? error.name : 'UnknownError'
  );
  process.exitCode = 1;
});

import 'dotenv/config';
import { readFileSync } from 'fs';
import path from 'path';
import postgres from 'postgres';

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--apply')) throw new Error('Only --apply is supported');
  if (!args.includes('--apply')) {
    console.log(
      'Dry run: add agent_cache_policies and response_cache_v2, plus indexes. No existing rows change. Use --apply after backup and database target verification.'
    );
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const client = postgres(process.env.DATABASE_URL, { max: 1 });
  try {
    const migration = readFileSync(
      path.resolve(__dirname, '../migrations/cache-stage-one.sql'),
      'utf8'
    );
    await client.begin(async (tx) => {
      await tx`SET LOCAL lock_timeout = '5s'`;
      await tx`SET LOCAL statement_timeout = '30s'`;
      await tx.unsafe(migration);
    });
    console.log(
      'Cache Stage 1 schema applied. Legacy entries remain untouched and ineligible. Apply Stage 2 schema before enabling agent policies.'
    );
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  // Database error objects can contain connection details; never print them.
  console.error(
    'Cache migration failed; transaction rolled back.',
    error instanceof Error ? error.name : 'UnknownError'
  );
  process.exitCode = 1;
});

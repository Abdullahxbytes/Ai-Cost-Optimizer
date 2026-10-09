import postgres from 'postgres';
import { createClient } from 'redis';
import { client } from '../../src/config/database';

async function truncateTestDatabase() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const tables = await sql<
      { table_name: string }[]
    >`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`;
    if (tables.length) {
      const names = tables
        .map(({ table_name }) => `"${table_name.replace(/"/g, '""')}"`)
        .join(', ');
      await sql.unsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
    }
  } finally {
    await sql.end();
  }
}

afterEach(async () => {
  await truncateTestDatabase();
  const redis = createClient({ url: process.env.REDIS_URL });
  await redis.connect();
  await redis.flushDb();
  await redis.quit();
});

// Jest creates an isolated module registry for each test file, so these are the
// same database singleton used by that file's application instance. The shared
// Redis socket is already unref'ed in test mode; do not quit it here because a
// Jest worker can reuse it in a later test file.
afterAll(async () => {
  await client.end({ timeout: 5 });
});

import { readFileSync } from 'fs';
import path from 'path';
import { sql } from 'drizzle-orm';
import { db } from '../../src/config/database';

it('applies the additive SQL to a clean schema and can be rerun without data loss', async () => {
  const rollback = new Error('Rollback isolated migration fixture');
  const migration = readFileSync(
    path.resolve(__dirname, '../../migrations/cache-stage-one.sql'),
    'utf8'
  );
  const stageTwoMigration = readFileSync(
    path.resolve(__dirname, '../../migrations/cache-stage-two.sql'),
    'utf8'
  );
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`CREATE SCHEMA cache_stage_one_migration_test`);
      await tx.execute(sql`SET LOCAL search_path TO cache_stage_one_migration_test, public`);
      await tx.execute(sql`CREATE TABLE orgs (id uuid PRIMARY KEY)`);
      await tx.execute(sql`CREATE TABLE agents (id uuid PRIMARY KEY)`);
      await tx.execute(sql.raw(migration));
      await tx.execute(sql`INSERT INTO orgs VALUES ('00000000-0000-4000-8000-000000000001')`);
      await tx.execute(sql`INSERT INTO agents VALUES ('00000000-0000-4000-8000-000000000002')`);
      await tx.execute(sql`INSERT INTO agent_cache_policies (agent_id, org_id, policy) VALUES
        ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', '{"mode":"off"}')`);
      await tx.execute(sql.raw(migration));
      const rows = await tx.execute(sql`SELECT revision FROM agent_cache_policies`);
      expect(rows).toHaveLength(1);
      expect(rows[0].revision).toBe(1);
      const columns = await tx.execute(
        sql`SELECT column_name FROM information_schema.columns WHERE table_schema = 'cache_stage_one_migration_test' AND table_name = 'response_cache_v2'`
      );
      expect(columns).toHaveLength(14);
      await tx.execute(sql.raw(stageTwoMigration));
      await tx.execute(sql.raw(stageTwoMigration));
      const diagnostics = await tx.execute(
        sql`SELECT column_name FROM information_schema.columns WHERE table_schema = 'cache_stage_one_migration_test' AND table_name = 'cache_request_diagnostics'`
      );
      expect(diagnostics).toHaveLength(14);
      const indexes = await tx.execute(
        sql`SELECT indexdef FROM pg_indexes WHERE schemaname = 'cache_stage_one_migration_test' AND indexname = 'response_cache_v2_unique_exact'`
      );
      expect(indexes).toHaveLength(1);
      expect(indexes[0].indexdef).toContain('UNIQUE INDEX');
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
});

import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { client, db } from '../src/config/database';
import { agents } from '../src/features/agents/agents.schema.db';
import { hashAgentKey, isAgentKeyHash } from '../src/utils/agentKey';

async function migrate() {
  const rows = await db.select({ id: agents.id, apiKey: agents.apiKey }).from(agents);
  const plaintextRows = rows.filter((row) => !isAgentKeyHash(row.apiKey));
  for (const row of plaintextRows) {
    await db.update(agents).set({ apiKey: hashAgentKey(row.apiKey), updatedAt: new Date() }).where(eq(agents.id, row.id));
  }
  const verification = await Promise.all(
    plaintextRows.map(async (row) => {
      const response = await fetch('http://localhost:3000/proxy/invalid/security-check', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-agent-key': row.apiKey },
        body: '{}',
      });
      return response.status !== 401;
    })
  );
  console.log(JSON.stringify({ migrated: plaintextRows.length, alreadyHashed: rows.length - plaintextRows.length, authenticatedAfterMigration: verification.filter(Boolean).length, authenticationFailures: verification.filter((result) => !result).length }));
}

migrate()
  .catch((error) => {
    console.error('Agent-key migration failed');
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => client.end());

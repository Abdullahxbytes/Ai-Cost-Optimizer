import 'dotenv/config';
import { db } from '../src/config/database';
import { purgeExpiredTeamArchives } from '../src/jobs/teamArchiveCleanup';

async function main() {
  const purged = await purgeExpiredTeamArchives();
  console.log(`Purged ${purged} expired archived team(s).`);
  await db.$client.end();
}

main().catch(async (error) => {
  console.error(error);
  await db.$client.end();
  process.exitCode = 1;
});

import { client } from '../src/config/database';
import { redis } from '../src/config/redis';
import { alertScanner } from '../src/jobs/alertScanner';

async function main() {
  try {
    console.log(JSON.stringify(await alertScanner()));
  } finally {
    await redis.quit();
    await client.end();
  }
}

void main();

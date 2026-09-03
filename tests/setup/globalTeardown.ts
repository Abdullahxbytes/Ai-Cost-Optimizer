import { createClient } from 'redis';
import './env';

export default async function globalTeardown() {
  const redis = createClient({ url: process.env.REDIS_URL });
  await redis.connect();
  await redis.flushDb();
  await redis.quit();
}

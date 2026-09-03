import { createClient } from 'redis';
import { env } from './env';
export const redis = createClient({ url: env.REDIS_URL });

redis.on('error', (error) => process.stderr.write(`Redis error: ${error.message}\n`));
redis
  .connect()
  .then(() => {
    // Keep Jest from waiting on the shared Redis socket after an isolated test run.
    // The client remains usable; this only prevents the socket from holding Node open.
    if (env.NODE_ENV === 'test') {
      redis.unref();
    }
  })
  .catch((error: Error) => process.stderr.write(`Redis connection failed: ${error.message}\n`));

import { createClient } from 'redis'
import { env } from './env'
export const redis = createClient({ url: env.REDIS_URL })

redis.on('error', (error) => process.stderr.write(`Redis error: ${error.message}\n`))
redis.connect().catch((error: Error) => process.stderr.write(`Redis connection failed: ${error.message}\n`))

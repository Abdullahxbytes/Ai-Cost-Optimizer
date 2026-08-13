import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import Fastify from 'fastify'
import { env } from './config/env'
import { errorHandler } from './middleware/errorHandler'
import { logger } from './utils/logger'
export async function buildApp() { const app = Fastify({ logger: { level: env.LOG_LEVEL }, trustProxy: true }); await app.register(helmet); await app.register(cors, { origin: '*' }); app.setErrorHandler((error, request, reply) => errorHandler(error, request, reply)); app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() })); return app }
async function start() { const app = await buildApp(); try { await app.listen({ port: env.PORT, host: '0.0.0.0' }); logger.info(`Server running at http://localhost:${env.PORT}`) } catch (error) { logger.error(error); process.exit(1) } }
if (require.main === module) void start()

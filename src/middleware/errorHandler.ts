import { FastifyReply, FastifyRequest } from 'fastify'
import { AppError, RateLimitError } from '../utils/errors'
import { logger } from '../utils/logger'
export async function errorHandler(error: Error, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof AppError) { logger.warn({ error, url: request.url }, 'Application error'); return reply.status(error.statusCode).send({ error: error.message, code: error.code, ...(error instanceof RateLimitError && { retryAfter: error.retryAfter }) }) }
  logger.error({ error, url: request.url }, 'Unhandled error'); return reply.status(500).send({ error: 'Internal server error' })
}

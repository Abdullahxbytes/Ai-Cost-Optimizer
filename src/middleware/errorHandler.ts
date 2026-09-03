import { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, BudgetExceededError, ProviderError, RateLimitError } from '../utils/errors';
import { logger } from '../utils/logger';
export async function errorHandler(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  const normalizedError = error instanceof Error ? error : new Error('Unknown error');
  if (normalizedError instanceof AppError) {
    logger.warn({ error: normalizedError, url: request.url }, 'Application error');
    return reply
      .status(normalizedError.statusCode)
      .send({
        error: normalizedError.message,
        code: normalizedError.code,
        ...(normalizedError instanceof RateLimitError && { retryAfter: normalizedError.retryAfter }),
        ...(normalizedError instanceof BudgetExceededError && { scope: normalizedError.scope }),
        ...(normalizedError instanceof ProviderError && {
          providerStatus: normalizedError.providerStatus,
          providerMessage: normalizedError.providerMessage,
        }),
      });
  }
  logger.error({ error: normalizedError, url: request.url }, 'Unhandled error');
  return reply.status(500).send({ error: 'Internal server error' });
}

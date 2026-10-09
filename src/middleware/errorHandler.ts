import { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, BudgetExceededError, ProviderError, RateLimitError } from '../utils/errors';
import { logger } from '../utils/logger';
export async function errorHandler(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  const normalizedError = error instanceof Error ? error : new Error('Unknown error');
  if (normalizedError instanceof AppError) {
    if (normalizedError instanceof RateLimitError)
      reply.header('Retry-After', normalizedError.retryAfter);
    logger.warn(
      {
        code: normalizedError.code,
        statusCode: normalizedError.statusCode,
        path: request.routeOptions.url,
      },
      'Application error'
    );
    return reply.status(normalizedError.statusCode).send({
      error: normalizedError.message,
      code: normalizedError.code,
      ...(normalizedError instanceof RateLimitError && {
        retryAfter: normalizedError.retryAfter,
        scope: normalizedError.scope,
      }),
      ...(normalizedError instanceof BudgetExceededError && { scope: normalizedError.scope }),
      ...(normalizedError instanceof ProviderError && {
        providerStatus: normalizedError.providerStatus,
        providerMessage: normalizedError.providerMessage,
      }),
    });
  }
  logger.error(
    { errorName: normalizedError.name, path: request.routeOptions.url },
    'Unhandled error'
  );
  return reply.status(500).send({ error: 'Internal server error' });
}

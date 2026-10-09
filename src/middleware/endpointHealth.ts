import { FastifyReply, FastifyRequest } from 'fastify';
import { redis } from '../config/redis';

const MAX_SAMPLES = 1000;
export function trackEndpointResponse(request: FastifyRequest, reply: FastifyReply) {
  const route = request.routeOptions.url ?? request.url.split('?')[0];
  const key = `endpoint:health:${request.method}:${route}`;
  const sample = JSON.stringify({
    statusCode: reply.statusCode,
    durationMs: reply.elapsedTime,
    timestamp: Date.now(),
  });
  // Intentionally fire-and-forget: operational telemetry must never delay an application response.
  void redis
    .lPush(key, sample)
    .then(() => redis.lTrim(key, 0, MAX_SAMPLES - 1))
    .catch(() => undefined);
}

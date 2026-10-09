import { randomUUID } from 'crypto';
import { FastifyReply, FastifyRequest } from 'fastify';
import { ProviderName } from './providers/provider.types';
import { proxyService } from './proxy.service';
import { ProviderError, ValidationError } from '../../utils/errors';

export type ProxyRouteParams = { provider: string; '*': string };

function getForwardPath(request: FastifyRequest<{ Params: ProxyRouteParams }>): string {
  const queryIndex = request.raw.url?.indexOf('?') ?? -1;
  const query = queryIndex >= 0 ? request.raw.url?.slice(queryIndex) : '';
  return `${request.params['*']}${query}`;
}

function isJsonPayload(payload: unknown): payload is Record<string, unknown> | unknown[] {
  return typeof payload === 'object' && payload !== null && !Buffer.isBuffer(payload);
}

function getHeaderValue(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' ? value : undefined;
}

function getEnvironment(request: FastifyRequest): 'dev' | 'staging' | 'prod' {
  const environment = getHeaderValue(request, 'x-environment');
  return environment === 'staging' || environment === 'prod' ? environment : 'dev';
}

export const proxyController = {
  async forward(request: FastifyRequest<{ Params: ProxyRouteParams }>, reply: FastifyReply) {
    // agentAuth has already authenticated this request and attached request.agent.
    const path = getForwardPath(request);
    if (getHeaderValue(request, 'x-is-test') !== undefined) {
      throw new ValidationError('X-Is-Test is not accepted on the public proxy');
    }
    const isTest = false;
    const taskId = getHeaderValue(request, 'x-task-id') ?? randomUUID();
    const environment = getEnvironment(request);
    let response;
    let latencyMs;
    let originalTokenCount;
    let optimizedTokenCount;
    let budgetReservation;
    let cacheHit = false;
    let cacheResult;
    try {
      ({ response, latencyMs, originalTokenCount, optimizedTokenCount, budgetReservation, cacheHit, cacheResult } = await proxyService.forward(
        request.params.provider,
        path,
        request.body,
        request.agent,
        isTest,
        { environment, taskId, userContextToken: getHeaderValue(request, 'x-costflow-user-context') }
      ));
    } catch (error) {
      if (error instanceof ProviderError) {
        void proxyService.recordFailedUsage({
          agent: request.agent,
          provider: request.params.provider as ProviderName,
          path,
          body: request.body,
          taskId,
          environment,
          isTest,
          latencyMs: error.latencyMs,
          status: error.isTimeout ? 'timeout' : 'error',
        });
      }
      throw error;
    }

    if (isJsonPayload(response.data)) {
      reply.type('application/json');
    } else {
      const contentType = response.headers.contentType;
      if (typeof contentType === 'string') reply.header('content-type', contentType);
    }

    const usageInput = {
      agent: request.agent,
      provider: request.params.provider as ProviderName,
      path,
      body: request.body,
      taskId,
      environment,
      isTest,
      response,
      latencyMs,
      originalTokenCount,
      optimizedTokenCount,
      budgetReservation,
    };

    if (cacheHit) await proxyService.recordCacheHitUsage(usageInput);
    else await proxyService.recordSuccessfulUsage(usageInput);

    reply.header('x-costflow-cache', cacheResult?.outcome ?? 'bypass');
    if (cacheResult) reply.header('x-costflow-cache-reason', cacheResult.reason);
    reply.status(response.status).send(response.data);
    return reply;
  },
};

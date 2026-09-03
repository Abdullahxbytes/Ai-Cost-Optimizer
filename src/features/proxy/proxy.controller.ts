import { randomUUID } from 'crypto';
import { FastifyReply, FastifyRequest } from 'fastify';
import { ProviderName } from './providers/provider.types';
import { proxyService } from './proxy.service';
import { ProviderError } from '../../utils/errors';

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
    const isTest = getHeaderValue(request, 'x-is-test') === 'true';
    const taskId = getHeaderValue(request, 'x-task-id') ?? randomUUID();
    const environment = getEnvironment(request);
    let response;
    let latencyMs;
    let cacheHit;
    let originalTokenCount;
    let optimizedTokenCount;
    let budgetReservation;
    try {
      ({ response, latencyMs, cacheHit, originalTokenCount, optimizedTokenCount, budgetReservation } = await proxyService.forward(
        request.params.provider,
        path,
        request.body,
        request.agent,
        isTest
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

    if (cacheHit) {
      void proxyService.recordCacheHitUsage({
        agent: usageInput.agent,
        provider: usageInput.provider,
        path: usageInput.path,
        body: usageInput.body,
        taskId: usageInput.taskId,
        environment: usageInput.environment,
        isTest: usageInput.isTest,
      });
    } else {
      // The reservation is deliberately held until the exact provider cost is recorded.
      await proxyService.recordSuccessfulUsage(usageInput);
      void proxyService.cacheSuccessfulResponse(usageInput);
    }

    reply.status(response.status).send(response.data);
    return reply;
  },
};

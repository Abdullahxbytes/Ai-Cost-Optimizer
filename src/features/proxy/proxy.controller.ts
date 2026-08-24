import { randomUUID } from 'crypto';
import { FastifyReply, FastifyRequest } from 'fastify';
import { ProviderName } from './providers/provider.types';
import { proxyService } from './proxy.service';

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
    const { response, latencyMs } = await proxyService.forward(
      request.params.provider,
      path,
      request.body
    );

    if (isJsonPayload(response.data)) {
      reply.type('application/json');
    } else {
      const contentType = response.headers.contentType;
      if (typeof contentType === 'string') reply.header('content-type', contentType);
    }

    reply.status(response.status).send(response.data);

    // Usage writes are intentionally asynchronous so they never delay the agent response.
    void proxyService.recordSuccessfulUsage({
      agent: request.agent,
      provider: request.params.provider as ProviderName,
      path,
      body: request.body,
      taskId: getHeaderValue(request, 'x-task-id') ?? randomUUID(),
      environment: getEnvironment(request),
      isTest: getHeaderValue(request, 'x-is-test') === 'true',
      response,
      latencyMs,
    });

    return reply;
  },
};

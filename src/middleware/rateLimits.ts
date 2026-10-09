import { FastifyRequest } from 'fastify';
import { env } from '../config/env';
import { consumeRateLimit } from '../utils/rateLimit';

export async function globalEmergencyLimit(request: FastifyRequest): Promise<void> {
  if (request.method === 'OPTIONS' || request.url === '/health') return;
  await consumeRateLimit({
    key: 'global-api',
    limit: env.GLOBAL_API_RATE_LIMIT_PER_MINUTE,
    windowSeconds: 60,
    scope: 'global',
    message: 'Service request safety limit exceeded',
  });
}

export async function proxyIpEmergencyLimit(request: FastifyRequest): Promise<void> {
  await consumeRateLimit({
    key: `proxy-ip:${request.ip}`,
    limit: env.PROXY_IP_EMERGENCY_LIMIT_PER_MINUTE,
    windowSeconds: 60,
    scope: 'ip',
    message: 'Proxy IP safety limit exceeded',
  });
}

export async function authenticatedProxyRateLimits(request: FastifyRequest): Promise<void> {
  await consumeRateLimit({
    key: `agent:${request.agent.id}`,
    limit: env.AGENT_RATE_LIMIT_PER_MINUTE,
    windowSeconds: 60,
    scope: 'agent',
    message: 'Agent request rate exceeded',
  });
  await consumeRateLimit({
    key: `proxy-org:${request.agent.orgId}`,
    limit: env.ORG_PROXY_RATE_LIMIT_PER_MINUTE,
    windowSeconds: 60,
    scope: 'organization',
    message: 'Organization proxy rate exceeded',
  });
}

export async function dashboardRateLimits(request: FastifyRequest): Promise<void> {
  const write = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
  await consumeRateLimit({
    key: `dashboard-user:${write ? 'write' : 'read'}:${request.user.id}`,
    limit: write ? env.USER_WRITE_RATE_LIMIT_PER_MINUTE : env.USER_READ_RATE_LIMIT_PER_MINUTE,
    windowSeconds: 60,
    scope: 'user',
    message: `Dashboard ${write ? 'write' : 'read'} rate exceeded`,
  });
  if (request.user.orgId)
    await consumeRateLimit({
      key: `dashboard-org:${request.user.orgId}`,
      limit: env.ORG_DASHBOARD_RATE_LIMIT_PER_MINUTE,
      windowSeconds: 60,
      scope: 'organization',
      message: 'Organization dashboard rate exceeded',
    });
}

export async function exportRateLimit(request: FastifyRequest): Promise<void> {
  await consumeRateLimit({
    key: `export-user:${request.user.id}`,
    limit: 10,
    windowSeconds: 60,
    scope: 'endpoint',
    message: 'Export rate exceeded',
  });
}

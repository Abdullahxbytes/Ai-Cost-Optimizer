import { FastifyPluginAsync } from 'fastify';
import { agentAuth } from '../../middleware/agentAuth';
import { proxyController, ProxyRouteParams } from './proxy.controller';
import { authenticatedProxyRateLimits, proxyIpEmergencyLimit } from '../../middleware/rateLimits';

export const proxyRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Params: ProxyRouteParams }>(
    '/:provider/*',
    { preHandler: [proxyIpEmergencyLimit, agentAuth, authenticatedProxyRateLimits] },
    proxyController.forward
  );
};

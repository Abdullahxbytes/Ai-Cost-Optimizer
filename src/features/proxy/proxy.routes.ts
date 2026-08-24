import { FastifyPluginAsync } from 'fastify';
import { agentAuth } from '../../middleware/agentAuth';
import { proxyController, ProxyRouteParams } from './proxy.controller';

export const proxyRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Params: ProxyRouteParams }>(
    '/:provider/*',
    { preHandler: [agentAuth] },
    proxyController.forward
  );
};

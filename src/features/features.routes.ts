import { FastifyPluginAsync } from 'fastify';
import { userRoutes } from './user/user.routes';
import { orgsRoutes } from './orgs/orgs.routes';
import { teamsRoutes } from './teams/teams.routes';
import { agentsRoutes } from './agents/agents.routes';
import { budgetsRoutes } from './budgets/budgets.routes';
import { proxyRoutes } from './proxy/proxy.routes';
import { optimizationRoutes } from './optimization/optimization.routes';
import { alertsRoutes } from './alerts/alerts.routes';
export const featureRoutes: FastifyPluginAsync = async (app) => {
  await app.register(userRoutes, { prefix: '/auth' });
  await app.register(proxyRoutes, { prefix: '/proxy' });
  for (const route of [
    orgsRoutes,
    teamsRoutes,
    agentsRoutes,
    budgetsRoutes,
    optimizationRoutes,
    alertsRoutes,
  ])
    await app.register(route);
};

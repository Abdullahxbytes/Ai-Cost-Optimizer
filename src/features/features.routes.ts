import { FastifyPluginAsync } from 'fastify';
import { userManagementRoutes, userRoutes } from './user/user.routes';
import { orgsRoutes } from './orgs/orgs.routes';
import { teamsRoutes } from './teams/teams.routes';
import { agentsRoutes } from './agents/agents.routes';
import { budgetsRoutes } from './budgets/budgets.routes';
import { proxyRoutes } from './proxy/proxy.routes';
import { optimizationRoutes } from './optimization/optimization.routes';
import { alertsRoutes } from './alerts/alerts.routes';
import { notificationsRoutes } from './notifications/notifications.routes';
import { auditRoutes } from './audit/audit.routes';
import { analyticsRoutes } from './analytics/analytics.routes';
import { superAdminsRoutes } from './super-admins/super-admins.routes';
import { providerKeysRoutes } from './provider-keys/provider-keys.routes';
import { pricingRoutes } from './pricing/pricing.routes';
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
    notificationsRoutes,
    auditRoutes,
    userManagementRoutes,
    analyticsRoutes,
    superAdminsRoutes,
    providerKeysRoutes,
    pricingRoutes,
  ])
    await app.register(route);
};

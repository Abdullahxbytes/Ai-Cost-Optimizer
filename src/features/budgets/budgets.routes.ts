import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { budgetsController } from './budgets.controller';

export const budgetsRoutes: FastifyPluginAsync = async (app) => {
  app.post('/budgets', { preHandler: [authenticate, requireRole(['org_admin', 'team_lead'])] }, (request) => budgetsController.create(request));
  app.get('/budgets', { preHandler: [authenticate, requireRole(['org_admin', 'team_lead', 'developer'])] }, (request) => budgetsController.list(request));
  app.patch('/budgets/:budgetId', { preHandler: [authenticate, requireRole(['org_admin'])] }, (request) => budgetsController.update(request as never));
  app.delete('/budgets/:budgetId', { preHandler: [authenticate, requireRole(['org_admin'])] }, (request) => budgetsController.remove(request as never));
  app.post('/budgets/:budgetId/increase-requests', { preHandler: [authenticate, requireRole(['team_lead', 'developer'])] }, (request) => budgetsController.requestIncrease(request as never));
  app.get('/budget-requests', { preHandler: [authenticate, requireRole(['org_admin'])] }, (request) => budgetsController.listRequests(request));
  app.post('/budget-requests/:requestId/approve', { preHandler: [authenticate, requireRole(['org_admin'])] }, (request) => budgetsController.approve(request as never));
  app.post('/budget-requests/:requestId/reject', { preHandler: [authenticate, requireRole(['org_admin'])] }, (request) => budgetsController.reject(request as never));
};

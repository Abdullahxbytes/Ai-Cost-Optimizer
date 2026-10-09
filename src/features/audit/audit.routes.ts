import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { auditController } from './audit.controller';
import { exportRateLimit } from '../../middleware/rateLimits';

export const auditRoutes: FastifyPluginAsync = async (app) => {
  const readers = [authenticate, requireRole(['org_admin', 'auditor', 'super_admin'])];
  app.get('/audit-log', { preHandler: readers }, (request) => auditController.query(request));
  app.post('/audit-log/export', { preHandler: [...readers, exportRateLimit] }, (request, reply) => auditController.export(request, reply));
};

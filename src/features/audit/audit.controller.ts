import { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ValidationError } from '../../utils/errors';
import { AuditFilters } from './audit.repository';
import { auditService } from './audit.service';

const filtersSchema = z.object({
  orgId: z.string().uuid().optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional(),
  eventType: z.string().trim().min(1).optional(), actor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50), offset: z.coerce.number().int().min(0).default(0),
}).strict();
function parse(value: unknown) {
  const result = filtersSchema.safeParse(value);
  if (!result.success) throw new ValidationError(result.error.issues[0]?.message ?? 'Invalid audit filters');
  const to = result.data.to ?? new Date();
  if (result.data.from && result.data.from > to) throw new ValidationError('from must be before to');
  return { orgId: result.data.orgId, filters: { ...result.data, to } as AuditFilters };
}

export const auditController = {
  query(request: FastifyRequest) {
    const { orgId, filters } = parse(request.query);
    return auditService.query(request.user, orgId, filters);
  },
  async export(request: FastifyRequest, reply: FastifyReply) {
    const { orgId, filters } = parse(request.body ?? {});
    const result = await auditService.export(request.user, orgId, filters);
    return reply
      .type('text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="audit-log-${result.orgId}.csv"`)
      .send(result.csv);
  },
};

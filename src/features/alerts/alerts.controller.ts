import { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ValidationError } from '../../utils/errors';
import { AlertScope, AlertType } from './alerts.repository';
import { alertsService } from './alerts.service';

type AlertParams = { alertId: string };
const createSchema = z
  .object({
    type: z.enum(['budget', 'spike', 'runaway']),
    scope: z.enum(['org', 'team', 'agent']),
    scopeId: z.string().uuid(),
    thresholdPercent: z.number().min(1).max(100),
  })
  .strict();
const updateSchema = z
  .object({
    thresholdPercent: z.number().min(1).max(100).optional(),
    active: z.boolean().optional(),
  })
  .strict();
const historyQuerySchema = z.object({
  status: z.enum(['triggered', 'acknowledged', 'resolved']).optional(),
});
function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success)
    throw new ValidationError(result.error.issues[0]?.message ?? 'Invalid alert request');
  if (Object.keys(result.data as object).length === 0)
    throw new ValidationError('At least one alert field is required');
  return result.data;
}

export const alertsController = {
  create(request: FastifyRequest) {
    const body = parse(createSchema, request.body);
    return alertsService.create(
      request.user,
      body as { type: AlertType; scope: AlertScope; scopeId: string; thresholdPercent: number }
    );
  },
  list: (request: FastifyRequest) => alertsService.list(request.user),
  listHistory(request: FastifyRequest) {
    const query = historyQuerySchema.safeParse(request.query);
    if (!query.success)
      throw new ValidationError(query.error.issues[0]?.message ?? 'Invalid alert-history query');
    return alertsService.listHistory(request.user, query.data.status);
  },
  update(request: FastifyRequest<{ Params: AlertParams }>) {
    return alertsService.update(
      request.user,
      request.params.alertId,
      parse(updateSchema, request.body)
    );
  },
  acknowledge(request: FastifyRequest<{ Params: { alertHistoryId: string } }>) {
    return alertsService.acknowledge(request.user, request.params.alertHistoryId);
  },
};

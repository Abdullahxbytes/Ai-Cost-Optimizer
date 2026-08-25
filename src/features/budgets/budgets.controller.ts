import { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ValidationError } from '../../utils/errors';
import { BudgetScope } from './budgets.repository';
import { budgetsService } from './budgets.service';

type BudgetParams = { budgetId: string };
type RequestParams = { requestId: string };
const createSchema = z.object({ scope: z.enum(['org', 'team', 'agent']), scopeId: z.string().uuid(), limitAmount: z.number().positive(), period: z.enum(['daily', 'monthly']) }).strict();
const limitSchema = z.object({ limitAmount: z.number().positive() }).strict();
const requestSchema = z.object({ requestedAmount: z.number().positive() }).strict();
function parse<T>(schema: z.ZodType<T>, body: unknown): T { const result = schema.safeParse(body); if (!result.success) throw new ValidationError(result.error.issues[0]?.message ?? 'Invalid budget request'); return result.data; }

export const budgetsController = {
  create(request: FastifyRequest) { const body = parse(createSchema, request.body); return budgetsService.create(request.user, body as { scope: BudgetScope; scopeId: string; limitAmount: number; period: 'daily' | 'monthly' }); },
  list: (request: FastifyRequest) => budgetsService.list(request.user),
  update(request: FastifyRequest<{ Params: BudgetParams }>) { return budgetsService.update(request.user, request.params.budgetId, parse(limitSchema, request.body).limitAmount); },
  requestIncrease(request: FastifyRequest<{ Params: BudgetParams }>) { return budgetsService.requestIncrease(request.user, request.params.budgetId, parse(requestSchema, request.body).requestedAmount); },
  listRequests: (request: FastifyRequest) => budgetsService.listPendingRequests(request.user.orgId!),
  approve: (request: FastifyRequest<{ Params: RequestParams }>) => budgetsService.decideRequest(request.params.requestId, true, request.user),
  reject: (request: FastifyRequest<{ Params: RequestParams }>) => budgetsService.decideRequest(request.params.requestId, false, request.user),
};

import { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ValidationError } from '../../utils/errors';
import { pricingService } from './pricing.service';

const rateFields = {
  inputPricePer1k: z.number().nonnegative(),
  outputPricePer1k: z.number().nonnegative(),
  effectiveDate: z.coerce.date(),
};
const createSchema = z
  .object({
    provider: z.enum(['openai', 'anthropic', 'gemini']),
    model: z.string().trim().min(1).max(200),
    ...rateFields,
  })
  .strict();
const updateSchema = z.object(rateFields).strict();
function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success)
    throw new ValidationError(result.error.issues[0]?.message ?? 'Invalid pricing rate');
  return result.data;
}

export const pricingController = {
  list: (request: FastifyRequest) => pricingService.list(request.user),
  create: (request: FastifyRequest) =>
    pricingService.create(request.user, parse(createSchema, request.body)),
  update: (request: FastifyRequest<{ Params: { pricingId: string } }>) =>
    pricingService.update(
      request.user,
      request.params.pricingId,
      parse(updateSchema, request.body)
    ),
  remove: (request: FastifyRequest<{ Params: { pricingId: string } }>) =>
    pricingService.remove(request.user, request.params.pricingId),
};

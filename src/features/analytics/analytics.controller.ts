import { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ValidationError } from '../../utils/errors';
import { AnalyticsRequest, analyticsService } from './analytics.service';

const querySchema = z.object({
  from: z.coerce.date().optional(), to: z.coerce.date().optional(),
  bucket: z.enum(['daily', 'weekly', 'monthly']).optional(),
  scope: z.enum(['org', 'team', 'agent']).default('org'), scopeId: z.string().uuid().optional(),
}).strict();
const providerSwitchSchema = querySchema.extend({
  targetProvider: z.string().trim().min(1),
  targetModel: z.string().trim().min(1),
}).strict();
function request(query: unknown): AnalyticsRequest {
  const parsed = querySchema.safeParse(query);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid analytics query');
  const to = parsed.data.to ?? new Date();
  const rawTo = (query as { to?: unknown }).to;

  // A date input represents a complete calendar day, not midnight at its start.
  if (typeof rawTo === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawTo)) {
    to.setUTCHours(23, 59, 59, 999);
  }

  const from = parsed.data.from ?? new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (from > to) throw new ValidationError('from must be before to');
  return { scope: parsed.data.scope, scopeId: parsed.data.scopeId, bucket: parsed.data.bucket, range: { from, to } };
}

export const analyticsController = {
  byTime: (req: FastifyRequest) => analyticsService.byTime(req.user, request(req.query)),
  byProvider: (req: FastifyRequest) => analyticsService.byProvider(req.user, request(req.query)),
  byModel: (req: FastifyRequest) => analyticsService.byModel(req.user, request(req.query)),
  tokenSummary: (req: FastifyRequest) => analyticsService.tokenSummary(req.user, request(req.query)),
  tokensByAgent: (req: FastifyRequest) => analyticsService.tokensByAgent(req.user, request(req.query)),
  tokenSavings: (req: FastifyRequest) => analyticsService.tokenSavings(req.user, request(req.query)),
  cacheHitRate: (req: FastifyRequest) => analyticsService.cacheHitRate(req.user, request(req.query)),
  tokenReduction: (req: FastifyRequest) => analyticsService.tokenReduction(req.user, request(req.query)),
  optimizationCostSavings: (req: FastifyRequest) => analyticsService.optimizationCostSavings(req.user, request(req.query)),
  providerCostComparison: (req: FastifyRequest) => analyticsService.providerCostComparison(req.user, request(req.query)),
  agentsCostPerTask: (req: FastifyRequest) => analyticsService.agentsCostPerTask(req.user, request(req.query)),
  simulateProviderSwitch: (req: FastifyRequest) => {
    const parsed = providerSwitchSchema.safeParse(req.query);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid provider-switch simulation query');
    const { targetProvider, targetModel, ...analyticsQuery } = parsed.data;
    return analyticsService.simulateProviderSwitch(req.user, request(analyticsQuery), targetProvider, targetModel);
  },
};

import { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { canAccessAgent, canAccessTeam } from '../../middleware/rbac';
import { ForbiddenError, ValidationError } from '../../utils/errors';
import { OptimizationSettingsUpdate } from './optimization.repository';
import { optimizationService } from './optimization.service';
import { cachePolicyRepository } from './cache/cache.policy.repository';
import { CACHE_RUNTIME_STATUS } from './cache/cache.policy';
import { cacheRepository } from './cache/cache.repository';
import { issueCacheUserContext } from './cache/cache.userContext';
import { auditRepository } from '../audit/audit.repository';
import { cacheDiagnostics } from './cache/cache.diagnostics';

type AgentParams = { agentId: string };
type OrgParams = { orgId: string };
type TeamParams = { teamId: string };

const settingsPatch = z
  .object({
    promptOptimizationEnabled: z.boolean().optional(),
    semanticCacheEnabled: z.boolean().optional(),
    cacheSimilarityThreshold: z.number().gt(0).lte(1).optional(),
    cacheTtlSeconds: z.number().int().positive().optional(),
  })
  .strict();
const dateRangeQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
const cacheContextBody = z
  .object({
    subject: z.string().min(1).max(256),
    authorizationVersion: z.string().min(1).max(256),
  })
  .strict();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new ValidationError(result.error.issues[0]?.message ?? 'Invalid request');
  return result.data;
}

function getDateRange(query: unknown) {
  const parsed = parse(dateRangeQuery, query);
  const to = parsed.to ?? new Date();
  const from = parsed.from ?? new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (from > to) throw new ValidationError('from must be before to');
  return { from, to };
}

async function requireAgentAccess(request: FastifyRequest<{ Params: AgentParams }>) {
  if (!(await canAccessAgent(request.user, request.params.agentId))) {
    throw new ForbiddenError('Agent access denied');
  }
}

export const optimizationController = {
  async getSettings(request: FastifyRequest<{ Params: AgentParams }>) {
    await requireAgentAccess(request);
    return {
      ...(await optimizationService.getSettings(request.params.agentId)),
      cacheRuntimeStatus: CACHE_RUNTIME_STATUS,
    };
  },

  async getCachePolicy(request: FastifyRequest<{ Params: AgentParams }>) {
    await requireAgentAccess(request);
    return cachePolicyRepository.get(request.user.orgId!, request.params.agentId);
  },

  async replaceCachePolicy(request: FastifyRequest<{ Params: AgentParams }>) {
    await requireAgentAccess(request);
    return cachePolicyRepository.replace(
      request.user.orgId!,
      request.params.agentId,
      request.user.id,
      request.body
    );
  },

  async purgeCache(request: FastifyRequest<{ Params: AgentParams }>) {
    await requireAgentAccess(request);
    const deleted = await cacheRepository.purgeAgent(
      { orgId: request.user.orgId!, agentId: request.params.agentId },
      request.user.id
    );
    return { deleted };
  },

  async issueCacheContext(request: FastifyRequest<{ Params: AgentParams }>) {
    await requireAgentAccess(request);
    const body = parse(cacheContextBody, request.body);
    const token = issueCacheUserContext({
      orgId: request.user.orgId!,
      agentId: request.params.agentId,
      ...body,
    });
    await auditRepository.record({
      orgId: request.user.orgId!,
      actorUserId: request.user.id,
      eventType: 'cache_user_context_issued',
      targetType: 'agent',
      targetId: request.params.agentId,
      metadata: { ttlSeconds: 300 },
    });
    return { token, expiresInSeconds: 300 };
  },

  async getCacheDiagnostics(request: FastifyRequest<{ Params: AgentParams }>) {
    await requireAgentAccess(request);
    return cacheDiagnostics.list({ orgId: request.user.orgId!, agentId: request.params.agentId });
  },

  async patchSettings(request: FastifyRequest<{ Params: AgentParams }>) {
    await requireAgentAccess(request);
    const settings = await optimizationService.updateSettings(
      request.params.agentId,
      parse(settingsPatch, request.body) as OptimizationSettingsUpdate
    );
    return { ...settings, cacheRuntimeStatus: CACHE_RUNTIME_STATUS };
  },

  async getAgentSavings(request: FastifyRequest<{ Params: AgentParams }>) {
    await requireAgentAccess(request);
    return optimizationService.getSavingsSummary(
      'agent',
      request.params.agentId,
      request.user.orgId!,
      getDateRange(request.query)
    );
  },

  async getOrgSavings(request: FastifyRequest<{ Params: OrgParams }>) {
    return optimizationService.getSavingsSummary(
      'org',
      request.params.orgId,
      request.params.orgId,
      getDateRange(request.query)
    );
  },

  async getTeamSavings(request: FastifyRequest<{ Params: TeamParams }>) {
    if (!(await canAccessTeam(request.user, request.params.teamId))) {
      throw new ForbiddenError('Team access denied');
    }
    return optimizationService.getSavingsSummary(
      'team',
      request.params.teamId,
      request.user.orgId!,
      getDateRange(request.query)
    );
  },
};

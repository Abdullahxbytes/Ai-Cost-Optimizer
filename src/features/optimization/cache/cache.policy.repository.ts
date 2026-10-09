import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../../config/database';
import { ValidationError } from '../../../utils/errors';
import { auditLog } from '../../audit/audit.schema.db';
import { agents } from '../../agents/agents.schema.db';
import {
  CACHE_RUNTIME_STATUS,
  CACHE_SCHEMA_VERSION,
  DEFAULT_CACHE_POLICY,
  cachePolicySchema,
  policyEnvelopeSchema,
} from './cache.policy';
import { agentCachePolicies } from './cache.schema.db';

export const cachePolicyRepository = {
  async get(orgId: string, agentId: string) {
    const [row] = await db
      .select()
      .from(agentCachePolicies)
      .where(and(eq(agentCachePolicies.orgId, orgId), eq(agentCachePolicies.agentId, agentId)))
      .limit(1);
    const parsed =
      row &&
      policyEnvelopeSchema.safeParse({
        schemaVersion: row.schemaVersion,
        revision: row.revision,
        policy: row.policy,
      });
    return {
      ...(parsed?.success
        ? parsed.data
        : { schemaVersion: CACHE_SCHEMA_VERSION, revision: 0, policy: DEFAULT_CACHE_POLICY }),
      configured: !!parsed?.success,
      runtimeStatus: CACHE_RUNTIME_STATUS,
      reason: row ? (parsed?.success ? 'configured' : 'invalid_stored_policy') : 'not_configured',
    };
  },

  async replace(orgId: string, agentId: string, actorUserId: string, value: unknown) {
    const result = cachePolicySchema.safeParse(value);
    if (!result.success)
      throw new ValidationError(result.error.issues[0]?.message ?? 'Invalid cache policy');
    const policy = result.data;
    // Atomic revision increment: two writers cannot publish the same revision.
    // Audit and policy either both commit or neither does.
    const row = await db.transaction(async (tx) => {
      const [agent] = await tx
        .select({ id: agents.id })
        .from(agents)
        .where(and(eq(agents.id, agentId), eq(agents.orgId, orgId)))
        .limit(1);
      if (!agent) throw new ValidationError('Cache policy scope mismatch');
      const [saved] = await tx
        .insert(agentCachePolicies)
        .values({ orgId, agentId, policy })
        .onConflictDoUpdate({
          target: agentCachePolicies.agentId,
          set: {
            policy,
            revision: sql`${agentCachePolicies.revision} + 1`,
            updatedAt: new Date(),
          },
          setWhere: eq(agentCachePolicies.orgId, orgId),
        })
        .returning();
      if (!saved) throw new ValidationError('Cache policy scope mismatch');
      await tx
        .insert(auditLog)
        .values({
          orgId,
          actorUserId,
          eventType: 'cache_policy_updated',
          targetType: 'agent',
          targetId: agentId,
          metadata: {
            mode: policy.mode,
            revision: saved.revision,
            schemaVersion: CACHE_SCHEMA_VERSION,
          },
        });
      return saved;
    });
    return {
      schemaVersion: row.schemaVersion,
      revision: row.revision,
      policy,
      configured: true,
      runtimeStatus: CACHE_RUNTIME_STATUS,
      reason: 'configured',
    };
  },
};

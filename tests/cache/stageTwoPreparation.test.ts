import { eq } from 'drizzle-orm';
import { db } from '../../src/config/database';
import { auditLog } from '../../src/features/audit/audit.schema.db';
import { cacheRepository } from '../../src/features/optimization/cache/cache.repository';
import { responseCache } from '../../src/features/optimization/cache/cache.schema.db';
import { cacheDiagnostics } from '../../src/features/optimization/cache/cache.diagnostics';
import { verifyCacheUserContext } from '../../src/features/optimization/cache/cache.userContext';
import { semanticCache } from '../../src/features/optimization/optimization.schema.db';
import { createAgent, createTenant, tenantToken, testApp } from '../helpers/auth';
import { allowed, body, context, input, policy } from './fixtures';

describe('staged Stage 2 cache controls', () => {
  it('records scoped diagnostics without request content and limits the reader by agent', async () => {
    const owner = await createTenant();
    const other = await createTenant();
    const { agent } = await createAgent({
      orgId: owner.org.id,
      ownerUserId: owner.user.id,
      status: 'active',
    });
    const app = await testApp();
    const scope = { orgId: owner.org.id, agentId: agent.id };
    try {
      await cacheDiagnostics.record({
        scope,
        taskId: null,
        provider: 'gemini',
        model: 'model',
        outcome: 'miss',
        reason: 'no_entry',
        lookupLatencyMs: 12,
        embeddingLatencyMs: 8,
        embeddingCostStatus: 'unknown',
      });
      expect(await cacheDiagnostics.list(scope)).toHaveLength(1);
      expect(await cacheDiagnostics.list({ ...scope, orgId: other.org.id })).toHaveLength(0);
      const url = `/agents/${agent.id}/cache-diagnostics`;
      expect(
        (
          await app.inject({
            method: 'GET',
            url,
            headers: { authorization: `Bearer ${tenantToken(other.user)}` },
          })
        ).statusCode
      ).toBe(403);
      const response = await app.inject({
        method: 'GET',
        url,
        headers: { authorization: `Bearer ${tenantToken(owner.user)}` },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()[0]).toMatchObject({
        outcome: 'miss',
        reason: 'no_entry',
        lookupLatencyMs: 12,
      });
      expect(JSON.stringify(response.json())).not.toContain('contents');
    } finally {
      await app.close();
    }
  });
  it('upserts exact entries only under the current policy and refuses old revisions', async () => {
    const { org, user } = await createTenant();
    const { agent } = await createAgent({ orgId: org.id, ownerUserId: user.id, status: 'active' });
    const app = await testApp();
    const url = `/agents/${agent.id}/cache-policy`;
    const headers = { authorization: `Bearer ${tenantToken(user)}` };
    const scope = { orgId: org.id, agentId: agent.id };
    try {
      expect((await app.inject({ method: 'PUT', url, headers, payload: policy })).statusCode).toBe(
        200
      );
      const decision = allowed({ context: { ...context, ...scope } });
      const first = {
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'first' } }],
      };
      expect(
        await cacheRepository.store({
          scope,
          decision,
          provider: 'openai',
          model: body.model,
          response: first,
        })
      ).toBe(true);
      expect((await cacheRepository.findExact(scope, decision))?.response).toEqual(first);
      const second = {
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'second' } }],
      };
      expect(
        await cacheRepository.store({
          scope,
          decision,
          provider: 'openai',
          model: body.model,
          response: second,
        })
      ).toBe(true);
      expect(await db.select().from(responseCache)).toHaveLength(1);
      expect((await cacheRepository.findExact(scope, decision))?.response).toEqual(second);
      const other = await createTenant();
      expect(
        await cacheRepository.findExact({ orgId: other.org.id, agentId: agent.id }, decision)
      ).toBeNull();
      expect(
        (
          await app.inject({
            method: 'PUT',
            url,
            headers,
            payload: { ...policy, knowledgeVersion: 'docs-2' },
          })
        ).statusCode
      ).toBe(200);
      expect(await cacheRepository.stillCurrent(scope, decision)).toBe(false);
      expect(
        await cacheRepository.store({
          scope,
          decision,
          provider: 'openai',
          model: body.model,
          response: second,
        })
      ).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('filters semantic candidates by tenant, partition, policy revision and embedding model', async () => {
    const { org, user } = await createTenant();
    const { agent } = await createAgent({ orgId: org.id, ownerUserId: user.id, status: 'active' });
    const app = await testApp();
    const scope = { orgId: org.id, agentId: agent.id };
    try {
      await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}/cache-policy`,
        headers: { authorization: `Bearer ${tenantToken(user)}` },
        payload: policy,
      });
      const decision = allowed({ context: { ...context, ...scope } });
      const embedding = Array(768).fill(0.1);
      const response = {
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
      };
      expect(
        await cacheRepository.store({
          scope,
          decision,
          provider: 'openai',
          model: body.model,
          response,
          embedding,
          embeddingModelVersion: 'gemini-embedding-001:768:v1',
        })
      ).toBe(true);
      expect(
        (
          await cacheRepository.findSemantic(
            scope,
            decision,
            'gemini-embedding-001:768:v1',
            embedding
          )
        )?.entry.response
      ).toEqual(response);
      expect(
        await cacheRepository.findSemantic(scope, decision, 'different:768:v1', embedding)
      ).toBeNull();
      expect(
        await cacheRepository.findSemantic(
          { ...scope, agentId: context.agentId },
          decision,
          'gemini-embedding-001:768:v1',
          embedding
        )
      ).toBeNull();
      expect(
        await cacheRepository.findSemantic(
          scope,
          { ...decision, partitionKey: 'different' },
          'gemini-embedding-001:768:v1',
          embedding
        )
      ).toBeNull();
      expect(
        await cacheRepository.findSemantic(
          scope,
          { ...decision, policyRevision: 2 },
          'gemini-embedding-001:768:v1',
          embedding
        )
      ).toBeNull();
    } finally {
      await app.close();
    }
  });

  it('issues short-lived signed end-user context only to an agent owner and rejects tampering', async () => {
    const owner = await createTenant();
    const stranger = await createTenant();
    const { agent } = await createAgent({
      orgId: owner.org.id,
      ownerUserId: owner.user.id,
      status: 'active',
    });
    const app = await testApp();
    const url = `/agents/${agent.id}/cache-context`;
    const payload = { subject: 'customer-42', authorizationVersion: 'access-v4' };
    try {
      expect(
        (
          await app.inject({
            method: 'POST',
            url,
            headers: { authorization: `Bearer ${tenantToken(stranger.user)}` },
            payload,
          })
        ).statusCode
      ).toBe(403);
      const result = await app.inject({
        method: 'POST',
        url,
        headers: { authorization: `Bearer ${tenantToken(owner.user)}` },
        payload,
      });
      expect(result.statusCode).toBe(200);
      const token: string = result.json().token;
      const authenticated = {
        id: agent.id,
        orgId: owner.org.id,
        teamId: null,
        ownerId: owner.user.id,
        status: 'active' as const,
      };
      expect(verifyCacheUserContext(token, authenticated)).toEqual(payload);
      expect(verifyCacheUserContext(`${token}x`, authenticated)).toBeNull();
      expect(
        verifyCacheUserContext(token, { ...authenticated, orgId: stranger.org.id })
      ).toBeNull();
      expect(verifyCacheUserContext(token, { ...authenticated, id: context.agentId })).toBeNull();
      const audit = await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.eventType, 'cache_user_context_issued'));
      expect(audit).toHaveLength(1);
      expect(JSON.stringify(audit[0].metadata)).not.toContain(payload.subject);
    } finally {
      await app.close();
    }
  });

  it('purges V2 and legacy rows only for the authorized agent and records counts', async () => {
    const tenant = await createTenant();
    const other = await createTenant();
    const a = await createAgent({
      orgId: tenant.org.id,
      ownerUserId: tenant.user.id,
      status: 'active',
    });
    const b = await createAgent({
      orgId: other.org.id,
      ownerUserId: other.user.id,
      status: 'active',
    });
    const app = await testApp();
    const insert = (agentId: string, orgId: string) =>
      db.insert(semanticCache).values({
        orgId,
        agentId,
        embedding: Array(768).fill(0.1),
        queryText: 'q',
        responseText: '{}',
        expiresAt: new Date(Date.now() + 60000),
      });
    try {
      await insert(a.agent.id, tenant.org.id);
      await insert(b.agent.id, other.org.id);
      const before = await app.inject({
        method: 'DELETE',
        url: `/agents/${a.agent.id}/cache`,
        headers: { authorization: `Bearer ${tenantToken(other.user)}` },
      });
      expect(before.statusCode).toBe(403);
      const result = await app.inject({
        method: 'DELETE',
        url: `/agents/${a.agent.id}/cache`,
        headers: { authorization: `Bearer ${tenantToken(tenant.user)}` },
      });
      expect(result.statusCode).toBe(200);
      expect(result.json()).toEqual({ deleted: 1 });
      expect(await db.select().from(semanticCache)).toHaveLength(1);
      const audit = await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.eventType, 'response_cache_purged'));
      expect(audit[0].metadata).toMatchObject({ currentCount: 0, legacyCount: 1 });
    } finally {
      await app.close();
    }
  });
});

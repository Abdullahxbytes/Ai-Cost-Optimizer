import axios from 'axios';
import { eq } from 'drizzle-orm';
import { db } from '../../src/config/database';
import { auditLog } from '../../src/features/audit/audit.schema.db';
import {
  agentCachePolicies,
  responseCache,
} from '../../src/features/optimization/cache/cache.schema.db';
import {
  optimizationRules,
  semanticCache,
} from '../../src/features/optimization/optimization.schema.db';
import { usageEvents } from '../../src/features/proxy/proxy.schema.db';
import { createAgent, createTenant, tenantToken, testApp } from '../helpers/auth';
import { geminiRequest, geminiSuccess, seedFinancialFixture } from '../helpers/financial';
import { seedRbacFixture } from '../helpers/rbac';
import { policy } from './fixtures';
import { agents } from '../../src/features/agents/agents.schema.db';

describe('cache policy API and legacy quarantine', () => {
  it('enforces schema constraints and cascades new policy/cache rows when an agent is deleted', async () => {
    const { org, user } = await createTenant();
    const { agent } = await createAgent({ orgId: org.id, ownerUserId: user.id, status: 'active' });
    const entry = {
      orgId: org.id,
      agentId: agent.id,
      policyRevision: 1,
      exactKey: 'test-key',
      provider: 'openai',
      model: 'test-model',
      response: {},
      createdAt: new Date('2026-10-07T00:00:00Z'),
      expiresAt: new Date('2026-10-07T01:00:00Z'),
    };
    await expect(db.insert(responseCache).values({ ...entry, schemaVersion: 1 })).rejects.toThrow();
    await expect(
      db.insert(responseCache).values({ ...entry, expiresAt: entry.createdAt })
    ).rejects.toThrow();
    await expect(
      db.insert(responseCache).values({ ...entry, embedding: Array(768).fill(0.1) })
    ).rejects.toThrow();
    await expect(
      db
        .insert(agentCachePolicies)
        .values({ orgId: org.id, agentId: agent.id, policy, revision: 0 })
    ).rejects.toThrow();
    await db.insert(agentCachePolicies).values({ orgId: org.id, agentId: agent.id, policy });
    await db.insert(responseCache).values(entry);
    await db.delete(agents).where(eq(agents.id, agent.id));
    expect(await db.select().from(agentCachePolicies)).toHaveLength(0);
    expect(await db.select().from(responseCache)).toHaveLength(0);
  });
  it('defaults off, validates policy, atomically versions changes and audits without sensitive contents', async () => {
    const { org, user } = await createTenant();
    const { agent } = await createAgent({ orgId: org.id, ownerUserId: user.id, status: 'active' });
    const app = await testApp();
    const url = `/agents/${agent.id}/cache-policy`;
    const headers = { authorization: `Bearer ${tenantToken(user)}` };
    try {
      expect((await app.inject({ method: 'GET', url, headers })).json()).toMatchObject({
        configured: false,
        revision: 0,
        policy: { mode: 'off' },
        runtimeStatus: 'active',
      });
      expect(
        (await app.inject({ method: 'PUT', url, headers, payload: { ...policy, ttlSeconds: 0 } }))
          .statusCode
      ).toBe(400);
      const created = await app.inject({ method: 'PUT', url, headers, payload: policy });
      expect(created.statusCode).toBe(200);
      expect(created.json()).toMatchObject({ revision: 1, policy, configured: true });
      const saves = await Promise.all(
        [2, 3].map(() => app.inject({ method: 'PUT', url, headers, payload: policy }))
      );
      expect(saves.map((r) => r.json().revision).sort()).toEqual([2, 3]);
      expect((await app.inject({ method: 'GET', url, headers })).json().revision).toBe(3);
      const audit = await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.eventType, 'cache_policy_updated'));
      expect(audit).toHaveLength(3);
      expect(audit[0].metadata).toEqual({ mode: 'exact_semantic', revision: 1, schemaVersion: 2 });
      await db
        .update(agentCachePolicies)
        .set({ policy: { mode: 'exact_semantic' } })
        .where(eq(agentCachePolicies.agentId, agent.id));
      expect((await app.inject({ method: 'GET', url, headers })).json()).toMatchObject({
        configured: false,
        policy: { mode: 'off' },
        reason: 'invalid_stored_policy',
      });
    } finally {
      await app.close();
    }
  });
  it('blocks cross-tenant access and unowned developer access on both routes', async () => {
    const { org, user } = await createTenant();
    const { agent } = await createAgent({ orgId: org.id, ownerUserId: user.id, status: 'active' });
    const foreign = await createTenant();
    const app = await testApp();
    try {
      for (const method of ['GET', 'PUT'] as const) {
        expect(
          (
            await app.inject({
              method,
              url: `/agents/${agent.id}/cache-policy`,
              headers: { authorization: `Bearer ${tenantToken(foreign.user)}` },
              ...(method === 'PUT' && { payload: policy }),
            })
          ).statusCode
        ).toBe(403);
      }
      expect(await db.select().from(agentCachePolicies)).toHaveLength(0);
      const developer = await createTenant({ role: 'developer' });
      const owned = await createAgent({
        orgId: developer.org.id,
        ownerUserId: developer.user.id,
        status: 'active',
      });
      const headers = { authorization: `Bearer ${tenantToken(developer.user)}` };
      expect(
        (
          await app.inject({
            method: 'PUT',
            url: `/agents/${owned.agent.id}/cache-policy`,
            headers,
            payload: policy,
          })
        ).statusCode
      ).toBe(200);
      const unowned = await createAgent({
        orgId: developer.org.id,
        ownerUserId: user.id,
        status: 'active',
      });
      expect(
        (
          await app.inject({
            method: 'PUT',
            url: `/agents/${unowned.agent.id}/cache-policy`,
            headers,
            payload: policy,
          })
        ).statusCode
      ).toBe(403);
    } finally {
      await app.close();
    }
  });
  it.each(['finance', 'auditor'] as const)('prevents %s policy mutation', async (role) => {
    const { org, user } = await createTenant({ role });
    const { agent } = await createAgent({ orgId: org.id, ownerUserId: user.id, status: 'active' });
    const app = await testApp();
    try {
      expect(
        (
          await app.inject({
            method: 'PUT',
            url: `/agents/${agent.id}/cache-policy`,
            headers: { authorization: `Bearer ${tenantToken(user)}` },
            payload: policy,
          })
        ).statusCode
      ).toBe(403);
    } finally {
      await app.close();
    }
  });
  it('allows team leads only for their team and rejects archived teams, anonymous callers and malformed IDs', async () => {
    const f = await seedRbacFixture();
    const app = await testApp();
    const url = `/agents/${f.agents.agentA.id}/cache-policy`;
    try {
      for (const method of ['GET', 'PUT'] as const) {
        const payload = method === 'PUT' ? { payload: policy } : {};
        expect(
          (
            await app.inject({
              method,
              url,
              ...payload,
              headers: { authorization: `Bearer ${f.token(f.users.leadA)}` },
            })
          ).statusCode
        ).toBe(200);
        expect(
          (
            await app.inject({
              method,
              url,
              ...payload,
              headers: { authorization: `Bearer ${f.token(f.users.leadB)}` },
            })
          ).statusCode
        ).toBe(403);
        expect((await app.inject({ method, url, ...payload })).statusCode).toBe(401);
      }
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/agents/not-a-uuid/cache-policy',
            headers: { authorization: `Bearer ${f.token(f.users.adminA)}` },
          })
        ).statusCode
      ).toBe(400);
      const { teams } = await import('../../src/features/teams/teams.schema.db');
      await db.update(teams).set({ status: 'archived' }).where(eq(teams.id, f.teams.teamA.id));
      expect(
        (
          await app.inject({
            method: 'PUT',
            url,
            payload: policy,
            headers: { authorization: `Bearer ${f.token(f.users.leadA)}` },
          })
        ).statusCode
      ).toBe(403);
    } finally {
      await app.close();
    }
  });
  it('never reads/writes legacy cache or embeds a request even when legacy semantic setting is on', async () => {
    const f = await seedFinancialFixture({ agentCount: 1 });
    const agent = f.agents[0];
    await db.insert(optimizationRules).values({
      orgId: f.org.id,
      agentId: agent.id,
      semanticCacheEnabled: true,
      cacheTtlSeconds: 3600,
    });
    await db.insert(semanticCache).values({
      orgId: f.org.id,
      agentId: agent.id,
      queryText: 'financial test prompt',
      responseText: JSON.stringify({ cached: true }),
      embedding: Array(768).fill(0.1),
      expiresAt: new Date(Date.now() + 3600000),
    });
    const app = await testApp();
    const spy = jest.spyOn(axios, 'post').mockResolvedValue(geminiSuccess() as never);
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await app.inject(geminiRequest(agent.rawKey));
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual(geminiSuccess().data);
        expect(response.headers['x-costflow-cache']).toBe('bypass');
        expect(response.headers['x-costflow-cache-reason']).toBe('policy_off');
      }
      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy.mock.calls.every(([path]) => String(path).includes('generateContent'))).toBe(true);
      const legacy = await db.select().from(semanticCache);
      expect(legacy).toHaveLength(1);
      expect(legacy[0].hitCount).toBe(0);
      expect(await db.select().from(responseCache)).toHaveLength(0);
      const usage = await db.select().from(usageEvents);
      expect(usage).toHaveLength(2);
      expect(usage.every((event) => !event.cacheHit)).toBe(true);
      // Additive schema does not break existing settings reads or prompt toggle writes.
      const headers = { authorization: `Bearer ${f.adminToken}` };
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/agents/${agent.id}/optimization-settings`,
            headers,
          })
        ).json().cacheRuntimeStatus
      ).toBe('active');
      expect(
        (
          await app.inject({
            method: 'PATCH',
            url: `/agents/${agent.id}/optimization-settings`,
            headers,
            payload: { promptOptimizationEnabled: true },
          })
        ).statusCode
      ).toBe(200);
    } finally {
      spy.mockRestore();
      await app.close();
    }
  });
});

import axios from 'axios';
import { randomUUID } from 'crypto';
import { db } from '../../src/config/database';
import { eq } from 'drizzle-orm';
import {
  cacheRequestDiagnostics,
  responseCache,
} from '../../src/features/optimization/cache/cache.schema.db';
import { issueCacheUserContext } from '../../src/features/optimization/cache/cache.userContext';
import { orgProviderKeys } from '../../src/features/provider-keys/provider-keys.schema.db';
import { usageEvents } from '../../src/features/proxy/proxy.schema.db';
import { seedFinancialFixture, geminiRequest } from '../helpers/financial';
import { testApp } from '../helpers/auth';
import { policy } from './fixtures';

const answer = {
  candidates: [
    { finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'A stable answer' }] } },
  ],
  usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 5 },
};
const providerReply = {
  status: 200,
  data: answer,
  headers: { 'content-type': 'application/json' },
};

describe('V2 cache runtime through the agent proxy', () => {
  it('misses then serves an exact hit without another provider request and records zero provider spend', async () => {
    const fixture = await seedFinancialFixture({ agentCount: 1 });
    const agent = fixture.agents[0];
    const app = await testApp();
    const post = jest.spyOn(axios, 'post').mockResolvedValue(providerReply as never);
    try {
      const saved = await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}/cache-policy`,
        headers: { authorization: `Bearer ${fixture.adminToken}` },
        payload: { ...policy, mode: 'exact' },
      });
      expect(saved.statusCode).toBe(200);
      const first = await app.inject(geminiRequest(agent.rawKey));
      const second = await app.inject(geminiRequest(agent.rawKey));
      expect(first.statusCode).toBe(200);
      expect(first.headers['x-costflow-cache']).toBe('miss');
      expect(second.statusCode).toBe(200);
      expect(second.headers['x-costflow-cache']).toBe('exact_hit');
      expect(second.json()).toEqual(answer);
      expect(post).toHaveBeenCalledTimes(1);
      const rows = await db.select().from(usageEvents);
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({
        cacheHit: true,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: '0.0000',
      });
      expect(rows[1].latencyMs).toBeGreaterThanOrEqual(0);
      expect(await db.select().from(responseCache)).toHaveLength(1);
      expect((await db.select().from(cacheRequestDiagnostics)).map((row) => row.outcome)).toEqual([
        'miss',
        'exact_hit',
      ]);
    } finally {
      post.mockRestore();
      await app.close();
    }
  });

  it('only reuses semantic matches in an approved partition and invalidates on policy change', async () => {
    const fixture = await seedFinancialFixture({ agentCount: 1 });
    const agent = fixture.agents[0];
    const app = await testApp();
    const post = jest.spyOn(axios, 'post').mockImplementation(async (url) => {
      if (String(url).includes(':embedContent')) {
        return {
          data: {
            embedding: { values: Array(768).fill(0.1) },
            usageMetadata: { promptTokenCount: 4 },
          },
        } as never;
      }
      return providerReply as never;
    });
    try {
      const policyUrl = `/agents/${agent.id}/cache-policy`;
      const headers = { authorization: `Bearer ${fixture.adminToken}` };
      expect(
        (await app.inject({ method: 'PUT', url: policyUrl, headers, payload: policy })).statusCode
      ).toBe(200);
      const request = geminiRequest(agent.rawKey);
      const first = await app.inject(request);
      const second = await app.inject({
        ...request,
        headers: { ...request.headers, 'x-task-id': randomUUID() },
        payload: { contents: [{ role: 'user', parts: [{ text: 'financial testing prompt' }] }] },
      });
      expect(first.headers['x-costflow-cache']).toBe('miss');
      expect(second.headers['x-costflow-cache']).toBe('semantic_hit');
      expect(
        post.mock.calls.filter(([url]) => !String(url).includes(':embedContent'))
      ).toHaveLength(1);
      expect((await db.select().from(cacheRequestDiagnostics))[1].embeddingCostStatus).toBe(
        'unknown'
      );
      expect(
        (
          await app.inject({
            method: 'PUT',
            url: policyUrl,
            headers,
            payload: { ...policy, knowledgeVersion: 'docs-2' },
          })
        ).statusCode
      ).toBe(200);
      const afterChange = await app.inject(geminiRequest(agent.rawKey));
      expect(afterChange.headers['x-costflow-cache']).toBe('miss');
      expect(
        post.mock.calls.filter(([url]) => !String(url).includes(':embedContent'))
      ).toHaveLength(2);
    } finally {
      post.mockRestore();
      await app.close();
    }
  });

  it('forwards when embedding fails and never stores an unsafe response', async () => {
    const fixture = await seedFinancialFixture({ agentCount: 1 });
    const agent = fixture.agents[0];
    const app = await testApp();
    const post = jest.spyOn(axios, 'post').mockImplementation(async (url) => {
      if (String(url).includes(':embedContent')) throw new Error('embedding offline');
      return {
        ...providerReply,
        data: {
          candidates: [
            {
              finishReason: 'MAX_TOKENS',
              content: { role: 'model', parts: [{ text: 'partial' }] },
            },
          ],
        },
      } as never;
    });
    try {
      expect(
        (
          await app.inject({
            method: 'PUT',
            url: `/agents/${agent.id}/cache-policy`,
            headers: { authorization: `Bearer ${fixture.adminToken}` },
            payload: policy,
          })
        ).statusCode
      ).toBe(200);
      const response = await app.inject(geminiRequest(agent.rawKey));
      expect(response.statusCode).toBe(200);
      expect(response.headers['x-costflow-cache']).toBe('miss');
      expect(response.headers['x-costflow-cache-reason']).toBe('embedding_unavailable');
      expect(await db.select().from(responseCache)).toHaveLength(0);
    } finally {
      post.mockRestore();
      await app.close();
    }
  });

  it('separates signed end users and invalidates entries when the provider key rotates', async () => {
    const fixture = await seedFinancialFixture({ agentCount: 1 });
    const agent = fixture.agents[0];
    const app = await testApp();
    const post = jest.spyOn(axios, 'post').mockResolvedValue(providerReply as never);
    try {
      expect(
        (
          await app.inject({
            method: 'PUT',
            url: `/agents/${agent.id}/cache-policy`,
            headers: { authorization: `Bearer ${fixture.adminToken}` },
            payload: { ...policy, mode: 'exact', scope: 'end_user' },
          })
        ).statusCode
      ).toBe(200);
      const alice = issueCacheUserContext({
        orgId: fixture.org.id,
        agentId: agent.id,
        subject: 'alice',
        authorizationVersion: 'v1',
      });
      const bob = issueCacheUserContext({
        orgId: fixture.org.id,
        agentId: agent.id,
        subject: 'bob',
        authorizationVersion: 'v1',
      });
      const request = (token?: string) => {
        const base = geminiRequest(agent.rawKey);
        return {
          ...base,
          headers: {
            ...base.headers,
            ...(token ? { 'x-costflow-user-context': token } : { 'x-user-id': 'alice' }),
          },
        };
      };
      expect((await app.inject(request())).headers['x-costflow-cache']).toBe('bypass');
      expect((await app.inject(request(alice))).headers['x-costflow-cache']).toBe('miss');
      expect((await app.inject(request(bob))).headers['x-costflow-cache']).toBe('miss');
      expect((await app.inject(request(alice))).headers['x-costflow-cache']).toBe('exact_hit');
      await db
        .update(orgProviderKeys)
        .set({ updatedAt: new Date(Date.now() + 1000) })
        .where(eq(orgProviderKeys.orgId, fixture.org.id));
      expect((await app.inject(request(alice))).headers['x-costflow-cache']).toBe('miss');
      expect(post).toHaveBeenCalledTimes(4);
    } finally {
      post.mockRestore();
      await app.close();
    }
  });
});

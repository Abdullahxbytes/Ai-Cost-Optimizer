import axios from 'axios';
import { randomUUID } from 'crypto';
import { jest } from '@jest/globals';
import { and, eq } from 'drizzle-orm';
import { db } from '../../src/config/database';
import { agentApprovals, agentTasks, agents } from '../../src/features/agents/agents.schema.db';
import { auditLog } from '../../src/features/audit/audit.schema.db';
import { budgets } from '../../src/features/budgets/budgets.schema.db';
import { optimizationRules, semanticCache } from '../../src/features/optimization/optimization.schema.db';
import { usageEvents } from '../../src/features/proxy/proxy.schema.db';
import { users } from '../../src/features/user/user.schema.db';
import { testApp } from '../helpers/auth';
import { createBudget, geminiRequest, geminiSuccess, seedFinancialFixture } from '../helpers/financial';

describe('agent deletion export, confirmation, and cascade integrity', () => {
  it('exports history, preserves pending-deletion proxy use, enforces recipient-only flow, and deletes all owned data', async () => {
    const f = await seedFinancialFixture({ agentCount: 1 }); const app = await testApp(); const agent = f.agents[0]; const taskId = randomUUID(); const spy = jest.spyOn(axios, 'post').mockResolvedValue(geminiSuccess(10, 5) as never);
    try {
      const [other] = await db.insert(users).values({ orgId: f.org.id, email: `other-${randomUUID()}@example.test`, passwordHash: 'not-used', role: 'developer' }).returning();
      await db.insert(agentTasks).values({ taskId, orgId: f.org.id, agentId: agent.id, totalCost: '1.2500', totalCalls: 1, status: 'completed', outcome: 'success' });
      await db.insert(usageEvents).values({ orgId: f.org.id, agentId: agent.id, taskId, stepNumber: 1, provider: 'gemini', model: 'gemini-3.6-flash', callType: 'llm_call', environment: 'dev', inputTokens: 10, outputTokens: 5, costUsd: '1.2500', latencyMs: 1, status: 'success', isTest: false, cacheHit: false });
      await db.insert(agentApprovals).values({ orgId: f.org.id, agentId: agent.id, requestedBy: f.admin.id, approvedBy: f.admin.id, status: 'approved', decidedAt: new Date() });
      await db.insert(optimizationRules).values({ orgId: f.org.id, agentId: agent.id, cacheTtlSeconds: 60 });
      await db.insert(semanticCache).values({ orgId: f.org.id, agentId: agent.id, embedding: Array(768).fill(0), queryText: 'historical question', responseText: '{"answer":"historical"}', expiresAt: new Date(Date.now() + 60_000) });
      const agentBudget = await createBudget({ orgId: f.org.id, scope: 'agent', scopeId: agent.id, limitAmount: 10 });

      const requested = await app.inject({ method: 'POST', url: `/agents/${agent.id}/request-deletion`, headers: { authorization: `Bearer ${f.adminToken}` } });
      expect(requested.statusCode).toBe(200); const deletionId = requested.json().id as string;
      const pendingProxy = await app.inject(geminiRequest(agent.rawKey)); expect(pendingProxy.statusCode).toBe(200); expect(spy).toHaveBeenCalledTimes(1);
      const otherHeaders = { authorization: `Bearer ${f.adminToken}` }; // alter token below to a real different-user token
      const { tenantToken } = await import('../helpers/auth'); const recipientDeniedHeaders = { authorization: `Bearer ${tenantToken(other)}` };
      expect((await app.inject({ method: 'GET', url: `/agent-deletions/${deletionId}/download`, headers: recipientDeniedHeaders })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST', url: `/agent-deletions/${deletionId}/confirm`, headers: recipientDeniedHeaders })).statusCode).toBe(403);
      const download = await app.inject({ method: 'GET', url: `/agent-deletions/${deletionId}/download`, headers: otherHeaders }); expect(download.statusCode).toBe(200); expect(download.body).toContain('gemini-3.6-flash'); expect(download.body).toContain('1.25');
      expect((await app.inject({ method: 'POST', url: `/agent-deletions/${deletionId}/cancel`, headers: otherHeaders })).statusCode).toBe(404);
      expect((await app.inject({ method: 'POST', url: `/agent-deletions/${deletionId}/confirm`, headers: otherHeaders })).statusCode).toBe(200);

      for (const table of [agents, usageEvents, agentTasks, semanticCache, optimizationRules, agentApprovals]) {
        const rows = table === agents ? await db.select().from(agents).where(eq(agents.id, agent.id))
          : table === usageEvents ? await db.select().from(usageEvents).where(eq(usageEvents.agentId, agent.id))
          : table === agentTasks ? await db.select().from(agentTasks).where(eq(agentTasks.agentId, agent.id))
          : table === semanticCache ? await db.select().from(semanticCache).where(eq(semanticCache.agentId, agent.id))
          : table === optimizationRules ? await db.select().from(optimizationRules).where(eq(optimizationRules.agentId, agent.id))
          : await db.select().from(agentApprovals).where(eq(agentApprovals.agentId, agent.id));
        expect(rows).toHaveLength(0);
      }
      expect(await db.select().from(budgets).where(eq(budgets.id, agentBudget.id))).toHaveLength(0);
      const audits = await db.select().from(auditLog).where(and(eq(auditLog.eventType, 'agent_deleted'), eq(auditLog.targetId, agent.id)));
      expect(audits).toHaveLength(1); expect(audits[0].metadata).toMatchObject({ agentName: agent.name, approvalHistory: expect.any(Array) }); expect(JSON.stringify(audits[0].metadata)).not.toMatch(/inputTokens|outputTokens|usageMetadata|historical question/);
    } finally { spy.mockRestore(); await app.close(); }
  });
});

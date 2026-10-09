import axios from 'axios';
import { jest } from '@jest/globals';
import { eq } from 'drizzle-orm';
import { redis } from '../../src/config/redis';
import { db } from '../../src/config/database';
import { usageEvents } from '../../src/features/proxy/proxy.schema.db';
import { testApp } from '../helpers/auth';
import { createBudget, geminiRequest, geminiSuccess, seedFinancialFixture, setBudgetSpend } from '../helpers/financial';

async function eventCount(agentId: string) { return (await db.select().from(usageEvents).where(eq(usageEvents.agentId, agentId))).length; }
describe('kill-switch and budget enforcement chain', () => {
  it('rejects killed agents and rejects the public test header before invoking the provider', async () => {
    const f = await seedFinancialFixture({ agentCount: 1 }); const app = await testApp(); const spy = jest.spyOn(axios, 'post').mockResolvedValue(geminiSuccess() as never);
    try { await redis.set(`killswitch:agent:${f.agents[0].id}`, '1'); expect((await app.inject(geminiRequest(f.agents[0].rawKey))).statusCode).toBe(403); expect((await app.inject(geminiRequest(f.agents[0].rawKey, undefined, true))).statusCode).toBe(400); expect(spy).not.toHaveBeenCalled(); expect(await eventCount(f.agents[0].id)).toBe(0); }
    finally { spy.mockRestore(); await app.close(); }
  });
  it('rejects over-budget normal traffic without provider call or usage event', async () => {
    const f = await seedFinancialFixture({ agentCount: 1 }); const app = await testApp(); const spy = jest.spyOn(axios, 'post').mockResolvedValue(geminiSuccess() as never);
    try { const budget = await createBudget({ orgId: f.org.id, scope: 'agent', scopeId: f.agents[0].id, limitAmount: 10 }); await setBudgetSpend('agent', f.agents[0].id, budget, 10); expect((await app.inject(geminiRequest(f.agents[0].rawKey))).statusCode).toBe(429); expect(spy).not.toHaveBeenCalled(); expect(await eventCount(f.agents[0].id)).toBe(0); }
    finally { spy.mockRestore(); await app.close(); }
  });
  it('rejects caller-controlled X-Is-Test traffic without invoking the provider', async () => {
    const f = await seedFinancialFixture({ agentCount: 1 }); const app = await testApp(); const spy = jest.spyOn(axios, 'post').mockResolvedValue(geminiSuccess() as never);
    try { const budget = await createBudget({ orgId: f.org.id, scope: 'agent', scopeId: f.agents[0].id, limitAmount: 10 }); await setBudgetSpend('agent', f.agents[0].id, budget, 10); const response = await app.inject(geminiRequest(f.agents[0].rawKey, undefined, true)); expect(response.statusCode).toBe(400); expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR' }); expect(spy).not.toHaveBeenCalled(); }
    finally { spy.mockRestore(); await app.close(); }
  });
});

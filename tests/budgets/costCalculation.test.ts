import axios from 'axios';
import { jest } from '@jest/globals';
import { eq } from 'drizzle-orm';
import { db } from '../../src/config/database';
import { usageEvents } from '../../src/features/proxy/proxy.schema.db';
import { testApp } from '../helpers/auth';
import { addRate, geminiRequest, geminiSuccess, seedFinancialFixture } from '../helpers/financial';

async function usageFor(agentId: string) {
  return (await db.select().from(usageEvents).where(eq(usageEvents.agentId, agentId)))[0];
}
describe('cost calculation accuracy', () => {
  it('records exact known token-count times rate cost', async () => {
    const f = await seedFinancialFixture({ agentCount: 1 });
    const app = await testApp();
    const spy = jest.spyOn(axios, 'post').mockResolvedValue(geminiSuccess(1000, 500) as never);
    try {
      await addRate(f.org.id, 0.004, 0.012);
      expect((await app.inject(geminiRequest(f.agents[0].rawKey))).statusCode).toBe(200);
      expect((await usageFor(f.agents[0].id))?.costUsd).toBe('0.0100');
    } finally {
      spy.mockRestore();
      await app.close();
    }
  });
  it('prefers an org-specific rate to the global default', async () => {
    const f = await seedFinancialFixture({ agentCount: 1 });
    const app = await testApp();
    const spy = jest.spyOn(axios, 'post').mockResolvedValue(geminiSuccess(1000, 0) as never);
    try {
      await addRate(null, 0.001, 0);
      await addRate(f.org.id, 0.009, 0);
      await app.inject(geminiRequest(f.agents[0].rawKey));
      expect((await usageFor(f.agents[0].id))?.costUsd).toBe('0.0090');
    } finally {
      spy.mockRestore();
      await app.close();
    }
  });
  it('uses a global default when no organization override exists', async () => {
    const f = await seedFinancialFixture({ agentCount: 1 });
    const app = await testApp();
    const spy = jest.spyOn(axios, 'post').mockResolvedValue(geminiSuccess(1000, 0) as never);
    try {
      await addRate(null, 0.007, 0);
      await app.inject(geminiRequest(f.agents[0].rawKey));
      expect((await usageFor(f.agents[0].id))?.costUsd).toBe('0.0070');
    } finally {
      spy.mockRestore();
      await app.close();
    }
  });
  it('records documented zero cost when no pricing rate exists', async () => {
    const f = await seedFinancialFixture({ agentCount: 1 });
    const app = await testApp();
    const spy = jest.spyOn(axios, 'post').mockResolvedValue(geminiSuccess(1000, 500) as never);
    try {
      await app.inject(geminiRequest(f.agents[0].rawKey));
      const event = await usageFor(f.agents[0].id);
      expect(event?.costUsd).toBe('0.0000');
      expect(event?.inputTokens).toBe(1000);
      expect(event?.outputTokens).toBe(500);
    } finally {
      spy.mockRestore();
      await app.close();
    }
  });
});

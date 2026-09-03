import axios from 'axios';
import { jest } from '@jest/globals';
import { testApp } from '../helpers/auth';
import { addRate, createBudget, geminiRequest, geminiSuccess, seedFinancialFixture, setBudgetSpend } from '../helpers/financial';

describe('financial race protection', () => {
  it('serializes concurrent agent-budget creation so exactly one $60 budget succeeds under $100', async () => {
    const f = await seedFinancialFixture(); const app = await testApp();
    try { await createBudget({ orgId: f.org.id, scope: 'team', scopeId: f.team.id, limitAmount: 100 }); const headers = { authorization: `Bearer ${f.adminToken}` }; const responses = await Promise.all(f.agents.map((agent) => app.inject({ method: 'POST', url: '/budgets', headers, payload: { scope: 'agent', scopeId: agent.id, limitAmount: 60, period: 'monthly' } }))); expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(1); expect(responses.filter((response) => response.statusCode === 400)).toHaveLength(1); }
    finally { await app.close(); }
  });

  it('serializes near-limit proxy calls so only one can spend past the current counter', async () => {
    const f = await seedFinancialFixture({ agentCount: 1 }); const app = await testApp(); const spy = jest.spyOn(axios, 'post').mockResolvedValue(geminiSuccess(1000, 0) as never);
    try { const budget = await createBudget({ orgId: f.org.id, scope: 'agent', scopeId: f.agents[0].id, limitAmount: 10 }); await createBudget({ orgId: f.org.id, scope: 'team', scopeId: f.team.id, limitAmount: 100 }); await addRate(f.org.id, 1, 0); await setBudgetSpend('agent', f.agents[0].id, budget, 9.5); const responses = await Promise.all([app.inject(geminiRequest(f.agents[0].rawKey)), app.inject(geminiRequest(f.agents[0].rawKey))]); expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(1); expect(responses.filter((response) => response.statusCode === 429)).toHaveLength(1); expect(spy).toHaveBeenCalledTimes(1); }
    finally { spy.mockRestore(); await app.close(); }
  });
});

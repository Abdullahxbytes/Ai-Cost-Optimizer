import { testApp } from '../helpers/auth';
import { createBudget, seedFinancialFixture } from '../helpers/financial';

describe('agent-budget hard block', () => {
  it('allows an $80 agent budget beneath a $100 team ceiling', async () => {
    const f = await seedFinancialFixture();
    const app = await testApp();
    try {
      await createBudget({ orgId: f.org.id, scope: 'team', scopeId: f.team.id, limitAmount: 100 });
      const response = await app.inject({
        method: 'POST',
        url: '/budgets',
        headers: { authorization: `Bearer ${f.adminToken}` },
        payload: { scope: 'agent', scopeId: f.agents[0].id, limitAmount: 80, period: 'monthly' },
      });
      expect(response.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
  it('rejects a second $30 agent budget above the $100 team ceiling', async () => {
    const f = await seedFinancialFixture();
    const app = await testApp();
    try {
      await createBudget({ orgId: f.org.id, scope: 'team', scopeId: f.team.id, limitAmount: 100 });
      await createBudget({
        orgId: f.org.id,
        scope: 'agent',
        scopeId: f.agents[0].id,
        limitAmount: 80,
      });
      const response = await app.inject({
        method: 'POST',
        url: '/budgets',
        headers: { authorization: `Bearer ${f.adminToken}` },
        payload: { scope: 'agent', scopeId: f.agents[1].id, limitAmount: 30, period: 'monthly' },
      });
      expect(response.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
  it('rejects directly increasing an agent budget past its team ceiling', async () => {
    const f = await seedFinancialFixture();
    const app = await testApp();
    try {
      await createBudget({ orgId: f.org.id, scope: 'team', scopeId: f.team.id, limitAmount: 100 });
      const agentBudget = await createBudget({
        orgId: f.org.id,
        scope: 'agent',
        scopeId: f.agents[0].id,
        limitAmount: 80,
      });
      await createBudget({
        orgId: f.org.id,
        scope: 'agent',
        scopeId: f.agents[1].id,
        limitAmount: 10,
      });
      const response = await app.inject({
        method: 'PATCH',
        url: `/budgets/${agentBudget.id}`,
        headers: { authorization: `Bearer ${f.adminToken}` },
        payload: { limitAmount: 95 },
      });
      expect(response.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
  it('rejects an over-ceiling approved increase and leaves it pending/unapplied', async () => {
    const f = await seedFinancialFixture();
    const app = await testApp();
    try {
      await createBudget({ orgId: f.org.id, scope: 'team', scopeId: f.team.id, limitAmount: 100 });
      const agentBudget = await createBudget({
        orgId: f.org.id,
        scope: 'agent',
        scopeId: f.agents[0].id,
        limitAmount: 80,
      });
      await createBudget({
        orgId: f.org.id,
        scope: 'agent',
        scopeId: f.agents[1].id,
        limitAmount: 10,
      });
      const request = await app.inject({
        method: 'POST',
        url: `/budgets/${agentBudget.id}/increase-requests`,
        headers: { authorization: `Bearer ${f.adminToken}` },
        payload: { requestedAmount: 95 },
      });
      expect(request.statusCode).toBe(403);
      const { db } = await import('../../src/config/database');
      const { budgetRequests } = await import('../../src/features/budgets/budgets.schema.db');
      const [pending] = await db
        .insert(budgetRequests)
        .values({
          orgId: f.org.id,
          budgetId: agentBudget.id,
          requestedBy: f.admin.id,
          requestedAmount: '95',
        })
        .returning();
      const approved = await app.inject({
        method: 'POST',
        url: `/budget-requests/${pending.id}/approve`,
        headers: { authorization: `Bearer ${f.adminToken}` },
      });
      expect(approved.statusCode).toBe(400);
      const { budgetsRepository } = await import('../../src/features/budgets/budgets.repository');
      expect((await budgetsRepository.findById(agentBudget.id))?.limitAmount).toBe(80);
    } finally {
      await app.close();
    }
  });
  it('allows an agent budget when the team has no configured budget', async () => {
    const f = await seedFinancialFixture();
    const app = await testApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/budgets',
        headers: { authorization: `Bearer ${f.adminToken}` },
        payload: { scope: 'agent', scopeId: f.agents[0].id, limitAmount: 999, period: 'monthly' },
      });
      expect(response.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});

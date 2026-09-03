import { testApp } from '../helpers/auth';
import { bearer, seedRbacFixture } from '../helpers/rbac';

describe('cross-organization IDOR denial', () => {
  it('denies Org A an Org B agent across read, state, and approval routes', async () => {
    const f = await seedRbacFixture(); const app = await testApp(); const headers = bearer(f.token(f.users.adminA));
    try {
      for (const request of [
        { method: 'GET' as const, url: `/agents/${f.agents.agentExternal.id}` },
        { method: 'POST' as const, url: `/agents/${f.agents.agentExternal.id}/pause` },
        { method: 'POST' as const, url: `/agents/${f.agents.agentExternal.id}/resume` },
        { method: 'POST' as const, url: `/agents/${f.agents.agentExternal.id}/approve` },
        { method: 'POST' as const, url: `/agents/${f.agents.agentExternal.id}/reject`, payload: {} },
      ]) expect((await app.inject({ ...request, headers })).statusCode).toBe(403);
    } finally { await app.close(); }
  });

  it('denies Org A an Org B team and budget by ID', async () => {
    const f = await seedRbacFixture(); const app = await testApp(); const headers = bearer(f.token(f.users.adminA));
    try {
      expect((await app.inject({ method: 'GET', url: `/teams/${f.teams.teamBExternal.id}`, headers })).statusCode).toBe(403);
      expect((await app.inject({ method: 'PATCH', url: `/teams/${f.teams.teamBExternal.id}`, headers, payload: { name: 'IDOR' } })).statusCode).toBe(403);
      // There is no GET /budgets/:budgetId route; the list route is scoped and the only ID route is PATCH.
      expect((await app.inject({ method: 'GET', url: '/budgets', headers })).json().map((row: { id: string }) => row.id)).not.toContain(f.budgets.externalBudget.id);
      expect((await app.inject({ method: 'PATCH', url: `/budgets/${f.budgets.externalBudget.id}`, headers, payload: { limitAmount: 10 } })).statusCode).toBe(403);
    } finally { await app.close(); }
  });

  it('denies Org A an Org B alert and alert-history record', async () => {
    const f = await seedRbacFixture(); const app = await testApp(); const headers = bearer(f.token(f.users.adminA));
    try {
      expect((await app.inject({ method: 'PATCH', url: `/alerts/${f.alerts.externalAlert.id}`, headers, payload: { active: false } })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST', url: `/alert-history/${f.alerts.externalHistory.id}/acknowledge`, headers })).statusCode).toBe(403);
    } finally { await app.close(); }
  });

  it('denies Org A querying Org B audit history, provider keys, and users', async () => {
    const f = await seedRbacFixture(); const app = await testApp(); const headers = bearer(f.token(f.users.adminA));
    try {
      expect((await app.inject({ method: 'GET', url: `/audit-log?orgId=${f.orgB.id}`, headers })).statusCode).toBe(403);
      expect((await app.inject({ method: 'GET', url: `/orgs/${f.orgB.id}/provider-keys`, headers })).statusCode).toBe(403);
      expect((await app.inject({ method: 'DELETE', url: `/orgs/${f.orgB.id}/provider-keys/gemini`, headers })).statusCode).toBe(403);
      expect((await app.inject({ method: 'GET', url: `/orgs/${f.orgB.id}/users`, headers })).statusCode).toBe(403);
      expect((await app.inject({ method: 'PATCH', url: `/orgs/${f.orgB.id}/users/${f.users.adminB.id}`, headers, payload: { role: 'developer' } })).statusCode).toBe(403);
    } finally { await app.close(); }
  });
});

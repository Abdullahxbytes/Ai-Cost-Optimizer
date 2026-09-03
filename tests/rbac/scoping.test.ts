import { seedRbacFixture, bearer } from '../helpers/rbac';
import { testApp } from '../helpers/auth';

describe('RBAC list scoping for every role', () => {
  it('Org Admin sees all own-org lists and no foreign-org rows', async () => {
    const f = await seedRbacFixture(); const app = await testApp();
    try {
      const headers = bearer(f.token(f.users.adminA));
      const [agents, teams, budgets, alerts] = await Promise.all(['agents', 'teams', 'budgets', 'alerts'].map((path) => app.inject({ method: 'GET', url: `/${path}`, headers })));
      expect(agents.statusCode).toBe(200); expect(agents.json().map((x: { id: string }) => x.id)).toEqual(expect.arrayContaining([f.agents.agentA.id, f.agents.agentOther.id, f.agents.agentSub.id]));
      expect(agents.json().map((x: { id: string }) => x.id)).not.toContain(f.agents.agentExternal.id);
      expect(teams.json().map((x: { id: string }) => x.id)).toEqual(expect.arrayContaining([f.teams.teamA.id, f.teams.teamB.id, f.teams.subTeam.id]));
      expect(teams.json().map((x: { id: string }) => x.id)).not.toContain(f.teams.teamBExternal.id);
      expect(budgets.json().map((x: { id: string }) => x.id)).toEqual(expect.arrayContaining([f.budgets.teamBudget.id, f.budgets.otherTeamBudget.id, f.budgets.agentBudget.id]));
      expect(budgets.json().map((x: { id: string }) => x.id)).not.toContain(f.budgets.externalBudget.id);
      expect(alerts.json().map((x: { id: string }) => x.id)).toEqual(expect.arrayContaining([f.alerts.teamAlert.id, f.alerts.otherTeamAlert.id]));
      expect(alerts.json().map((x: { id: string }) => x.id)).not.toContain(f.alerts.externalAlert.id);
    } finally { await app.close(); }
  });

  it('Team Lead sees only directly led team data, not other teams or sub-teams', async () => {
    const f = await seedRbacFixture(); const app = await testApp();
    try {
      const headers = bearer(f.token(f.users.leadA));
      const [agents, teams, budgets, alerts] = await Promise.all(['agents', 'teams', 'budgets', 'alerts'].map((path) => app.inject({ method: 'GET', url: `/${path}`, headers })));
      expect(agents.json().map((x: { id: string }) => x.id)).toEqual(expect.arrayContaining([f.agents.agentA.id, f.agents.agentOther.id]));
      expect(agents.json().map((x: { id: string }) => x.id)).not.toEqual(expect.arrayContaining([f.agents.agentSub.id, f.agents.agentExternal.id]));
      expect(teams.json().map((x: { id: string }) => x.id)).toEqual([f.teams.teamA.id]);
      expect(budgets.json().map((x: { id: string }) => x.id)).toEqual(expect.arrayContaining([f.budgets.teamBudget.id, f.budgets.agentBudget.id]));
      expect(budgets.json().map((x: { id: string }) => x.id)).not.toContain(f.budgets.otherTeamBudget.id);
      expect(alerts.json().map((x: { id: string }) => x.id)).toEqual([f.alerts.teamAlert.id]);
    } finally { await app.close(); }
  });

  it('Developer sees only their own agents, even in a shared team', async () => {
    const f = await seedRbacFixture(); const app = await testApp();
    try {
      const result = await app.inject({ method: 'GET', url: '/agents', headers: bearer(f.token(f.users.developerA)) });
      expect(result.statusCode).toBe(200); expect(result.json().map((x: { id: string }) => x.id)).toEqual([f.agents.agentA.id]);
    } finally { await app.close(); }
  });

  it('Finance has the supported org-wide read surface and all writes are forbidden', async () => {
    const f = await seedRbacFixture(); const app = await testApp();
    try {
      const headers = bearer(f.token(f.users.financeA));
      expect((await app.inject({ method: 'GET', url: '/analytics/costs/by-time?scope=org&scopeId=' + f.orgA.id, headers })).statusCode).toBe(200);
      expect((await app.inject({ method: 'POST', url: '/budgets', headers, payload: { scope: 'org', scopeId: f.orgA.id, limitAmount: 10, period: 'monthly' } })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST', url: '/alerts', headers, payload: { type: 'budget', scope: 'org', scopeId: f.orgA.id, thresholdPercent: 80 } })).statusCode).toBe(403);
    } finally { await app.close(); }
  });

  it('Auditor can read audit log only and is forbidden from operational lists', async () => {
    const f = await seedRbacFixture(); const app = await testApp();
    try {
      const headers = bearer(f.token(f.users.auditorA));
      expect((await app.inject({ method: 'GET', url: '/audit-log', headers })).statusCode).toBe(200);
      for (const path of ['agents', 'budgets', 'teams', 'alerts']) expect((await app.inject({ method: 'GET', url: `/${path}`, headers })).statusCode).toBe(403);
    } finally { await app.close(); }
  });

  it('Super Admin can explicitly target any organization without tenant org scope', async () => {
    const f = await seedRbacFixture(); const app = await testApp();
    try {
      const headers = bearer(f.superToken());
      expect((await app.inject({ method: 'GET', url: `/orgs/${f.orgB.id}`, headers })).statusCode).toBe(200);
      const audit = await app.inject({ method: 'GET', url: `/audit-log?orgId=${f.orgB.id}`, headers });
      expect(audit.statusCode).toBe(200); expect(audit.json().rows.every((row: { orgId: string }) => row.orgId === f.orgB.id)).toBe(true);
    } finally { await app.close(); }
  });
});

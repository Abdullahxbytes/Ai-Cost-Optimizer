import { testApp } from '../helpers/auth';
import { bearer, seedRbacFixture } from '../helpers/rbac';

describe('role-restricted routes', () => {
  it('rejects Developer attempts to create teams and budgets', async () => {
    const f = await seedRbacFixture();
    const app = await testApp();
    const headers = bearer(f.token(f.users.developerA));
    try {
      expect(
        (await app.inject({ method: 'POST', url: '/teams', headers, payload: { name: 'Nope' } }))
          .statusCode
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/budgets',
            headers,
            payload: {
              scope: 'agent',
              scopeId: f.agents.agentA.id,
              limitAmount: 10,
              period: 'monthly',
            },
          })
        ).statusCode
      ).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('rejects an Auditor attempting to register an agent', async () => {
    const f = await seedRbacFixture();
    const app = await testApp();
    try {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/agents',
            headers: bearer(f.token(f.users.auditorA)),
            payload: { name: 'Nope', teamId: f.teams.teamA.id },
          })
        ).statusCode
      ).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('rejects Team Lead direct budget edits and team-lead reassignment', async () => {
    const f = await seedRbacFixture();
    const app = await testApp();
    const headers = bearer(f.token(f.users.leadA));
    try {
      expect(
        (
          await app.inject({
            method: 'PATCH',
            url: `/budgets/${f.budgets.teamBudget.id}`,
            headers,
            payload: { limitAmount: 200 },
          })
        ).statusCode
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: 'PATCH',
            url: `/teams/${f.teams.teamA.id}`,
            headers,
            payload: { teamLeadId: f.users.leadB.id },
          })
        ).statusCode
      ).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('rejects every non-Org-Admin role from every provider-key operation', async () => {
    const f = await seedRbacFixture();
    const app = await testApp();
    try {
      for (const user of [f.users.leadA, f.users.developerA, f.users.financeA, f.users.auditorA]) {
        const headers = bearer(f.token(user));
        expect(
          (await app.inject({ method: 'GET', url: `/orgs/${f.orgA.id}/provider-keys`, headers }))
            .statusCode
        ).toBe(403);
        expect(
          (
            await app.inject({
              method: 'POST',
              url: `/orgs/${f.orgA.id}/provider-keys`,
              headers,
              payload: { provider: 'gemini', apiKey: 'x' },
            })
          ).statusCode
        ).toBe(403);
        expect(
          (
            await app.inject({
              method: 'DELETE',
              url: `/orgs/${f.orgA.id}/provider-keys/gemini`,
              headers,
            })
          ).statusCode
        ).toBe(403);
      }
    } finally {
      await app.close();
    }
  });

  it('keeps all Super Admin routes unreachable to every tenant role', async () => {
    const f = await seedRbacFixture();
    const app = await testApp();
    try {
      for (const user of [
        f.users.adminA,
        f.users.leadA,
        f.users.developerA,
        f.users.financeA,
        f.users.auditorA,
      ]) {
        const headers = bearer(f.token(user));
        expect(
          (await app.inject({ method: 'GET', url: '/super-admins', headers })).statusCode
        ).toBe(403);
        expect(
          (await app.inject({ method: 'GET', url: '/admin/health', headers })).statusCode
        ).toBe(403);
      }
    } finally {
      await app.close();
    }
  });
});

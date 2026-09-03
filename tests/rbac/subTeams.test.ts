import { testApp } from '../helpers/auth';
import { bearer, seedRbacFixture } from '../helpers/rbac';

describe('sub-team RBAC boundaries', () => {
  it('prevents a parent lead from viewing an unassigned sub-team', async () => {
    const f = await seedRbacFixture(); const app = await testApp();
    try { expect((await app.inject({ method: 'GET', url: `/teams/${f.teams.subTeam.id}`, headers: bearer(f.token(f.users.leadA)) })).statusCode).toBe(403); }
    finally { await app.close(); }
  });

  it('allows the specifically assigned sub-team lead to view their sub-team', async () => {
    const f = await seedRbacFixture(); const app = await testApp();
    try { const response = await app.inject({ method: 'GET', url: `/teams/${f.teams.subTeam.id}`, headers: bearer(f.token(f.users.subLead)) }); expect(response.statusCode).toBe(200); expect(response.json().id).toBe(f.teams.subTeam.id); }
    finally { await app.close(); }
  });

  it('rejects creating a sub-team beneath an existing sub-team', async () => {
    const f = await seedRbacFixture(); const app = await testApp();
    try {
      const response = await app.inject({ method: 'POST', url: `/teams/${f.teams.subTeam.id}/sub-teams`, headers: bearer(f.token(f.users.adminA)), payload: { name: 'Forbidden grandchild' } });
      expect(response.statusCode).toBe(400); expect(response.json().error).toBe('Cannot create a sub-team under a sub-team');
    } finally { await app.close(); }
  });

  it('allows an Org Admin to view and manage teams regardless of direct assignment', async () => {
    const f = await seedRbacFixture(); const app = await testApp();
    try {
      const headers = bearer(f.token(f.users.adminA));
      expect((await app.inject({ method: 'GET', url: `/teams/${f.teams.subTeam.id}`, headers })).statusCode).toBe(200);
      const update = await app.inject({ method: 'PATCH', url: `/teams/${f.teams.subTeam.id}`, headers, payload: { name: 'Admin managed sub-team' } });
      expect(update.statusCode).toBe(200); expect(update.json().name).toBe('Admin managed sub-team');
    } finally { await app.close(); }
  });
});

import {
  canAccessAgent,
  canAccessTeam,
  requireOrgScope,
  requireRole,
} from '../../src/middleware/rbac';
import { seedRbacFixture } from '../helpers/rbac';

describe('RBAC middleware core behavior', () => {
  it('requireRole([]) rejects tenant roles and Super Admin without an implicit bypass', async () => {
    for (const role of [
      'org_admin',
      'team_lead',
      'developer',
      'finance',
      'auditor',
      'super_admin',
    ] as const) {
      await expect(
        requireRole([])({
          user: { id: 'user', orgId: role === 'super_admin' ? null : 'org', role },
        } as never)
      ).rejects.toMatchObject({ statusCode: 403 });
    }
  });

  it('requireOrgScope rejects a resource belonging to a different organization', async () => {
    const f = await seedRbacFixture();
    await expect(
      requireOrgScope()({
        params: { orgId: f.orgB.id },
        user: { id: f.users.adminA.id, orgId: f.orgA.id, role: 'org_admin' },
      } as never)
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('canAccessTeam and canAccessAgent honor lead assignments, ownership, and org-admin access', async () => {
    const f = await seedRbacFixture();
    const admin = { id: f.users.adminA.id, orgId: f.orgA.id, role: 'org_admin' as const };
    const leadA = { id: f.users.leadA.id, orgId: f.orgA.id, role: 'team_lead' as const };
    const subLead = { id: f.users.subLead.id, orgId: f.orgA.id, role: 'team_lead' as const };
    const developerA = { id: f.users.developerA.id, orgId: f.orgA.id, role: 'developer' as const };
    const developerB = { id: f.users.developerB.id, orgId: f.orgA.id, role: 'developer' as const };
    await expect(canAccessTeam(leadA, f.teams.teamA.id)).resolves.toBe(true);
    await expect(canAccessTeam(leadA, f.teams.subTeam.id)).resolves.toBe(false);
    await expect(canAccessTeam(subLead, f.teams.subTeam.id)).resolves.toBe(true);
    await expect(canAccessTeam(admin, f.teams.subTeam.id)).resolves.toBe(true);
    await expect(canAccessAgent(admin, f.agents.agentOther.id)).resolves.toBe(true);
    await expect(canAccessAgent(leadA, f.agents.agentA.id)).resolves.toBe(true);
    await expect(canAccessAgent(leadA, f.agents.agentSub.id)).resolves.toBe(false);
    await expect(canAccessAgent(developerA, f.agents.agentA.id)).resolves.toBe(true);
    await expect(canAccessAgent(developerA, f.agents.agentOther.id)).resolves.toBe(false);
    await expect(canAccessAgent(developerB, f.agents.agentOther.id)).resolves.toBe(true);
  });
});

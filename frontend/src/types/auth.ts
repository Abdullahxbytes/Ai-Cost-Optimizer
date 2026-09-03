export type Role = 'super_admin' | 'org_admin' | 'team_lead' | 'developer' | 'finance' | 'auditor';

export type SessionUser = { id: string; email: string; role: Role; orgId: string | null };

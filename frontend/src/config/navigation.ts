import type { Role } from '../types/auth';

export type NavigationItem = { label: string; to: string; allowedRoles: Role[] };

export const navigationItems: NavigationItem[] = [
  { label: 'System Health', to: '/admin/health', allowedRoles: ['super_admin'] },
  { label: 'Org Management', to: '/admin/orgs', allowedRoles: ['super_admin'] },
  { label: 'Super Admin Management', to: '/admin/super-admins', allowedRoles: ['super_admin'] },
  { label: 'Dashboard', to: '/dashboard', allowedRoles: ['org_admin', 'team_lead'] },
  { label: 'Teams', to: '/teams', allowedRoles: ['org_admin'] },
  { label: 'Agents', to: '/agents', allowedRoles: ['org_admin', 'team_lead'] },
  { label: 'My Agents', to: '/agents', allowedRoles: ['developer'] },
  { label: 'Budgets', to: '/budgets', allowedRoles: ['org_admin', 'team_lead'] },
  { label: 'Alerts', to: '/alerts', allowedRoles: ['org_admin', 'team_lead'] },
  { label: 'Users', to: '/users', allowedRoles: ['org_admin'] },
  { label: 'Provider Keys', to: '/provider-keys', allowedRoles: ['org_admin'] },
  { label: 'Pricing', to: '/pricing', allowedRoles: ['org_admin'] },
  { label: 'Audit Log', to: '/audit-log', allowedRoles: ['org_admin', 'auditor'] },
  { label: 'Analytics', to: '/analytics', allowedRoles: ['team_lead'] },
  { label: 'My Budget Requests', to: '/budget-requests', allowedRoles: ['developer'] },
  { label: 'Notifications', to: '/notifications', allowedRoles: ['developer'] },
  { label: 'Cost Overview', to: '/analytics/costs', allowedRoles: ['finance'] },
  { label: 'Budget Alerts', to: '/notifications', allowedRoles: ['finance'] },
];

export function itemsForRole(role: Role) {
  return navigationItems.filter((item) => item.allowedRoles.includes(role));
}

export function defaultRouteForRole(role: Role) {
  return itemsForRole(role)[0]?.to ?? '/unauthorized';
}

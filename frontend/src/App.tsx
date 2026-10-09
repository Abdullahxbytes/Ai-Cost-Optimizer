import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { RoleGate } from './components/RoleGate';
import { defaultRouteForRole } from './config/navigation';
import { Agents } from './pages/Agents';
import { Alerts } from './pages/Alerts';
import { Analytics } from './pages/Analytics';
import { Budgets } from './pages/Budgets';
import { Dashboard } from './pages/Dashboard';
import { Landing } from './pages/Landing';
import { Legal } from './pages/Legal';
import { Login } from './pages/Login';
import { Signup } from './pages/Signup';
import { Notifications } from './pages/Notifications';
import { Unauthorized } from './pages/Unauthorized';
import { AuditLog } from './pages/AuditLog';
import { Users } from './pages/Users';
import { ProviderKeys } from './pages/ProviderKeys';
import { Pricing } from './pages/Pricing';
import { Teams } from './pages/Teams';
import { Profile } from './pages/Profile';
import { Health } from './pages/admin/Health';
import { Orgs } from './pages/admin/Orgs';
import { SuperAdmins } from './pages/admin/SuperAdmins';
import { useAuthStore } from './store/authStore';
import type { Role } from './types/auth';

const roles = {
  superAdmin: ['super_admin'],
  orgAdmin: ['org_admin'],
  developer: ['developer'],
  orgOrTeamLead: ['org_admin', 'team_lead'],
  orgTeamDeveloper: ['org_admin', 'team_lead', 'developer'],
  orgOrAuditor: ['org_admin', 'auditor'],
  analytics: ['org_admin', 'team_lead', 'finance'],
  all: ['super_admin', 'org_admin', 'team_lead', 'developer', 'finance', 'auditor'],
} satisfies Record<string, Role[]>;

function HomeRedirect() {
  const role = useAuthStore((state) => state.user?.role);
  return <Navigate replace to={role ? defaultRouteForRole(role) : '/'} />;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/privacy" element={<Legal title="Privacy" />} />
      <Route path="/terms" element={<Legal title="Terms" />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="unauthorized" element={<Unauthorized />} />
          <Route path="profile" element={<Profile />} />
          <Route element={<RoleGate allowedRoles={roles.superAdmin} />}>
            <Route path="admin/health" element={<Health />} />
            <Route path="admin/orgs" element={<Orgs />} />
            <Route path="admin/super-admins" element={<SuperAdmins />} />
          </Route>
          <Route element={<RoleGate allowedRoles={roles.orgOrTeamLead} />}>
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="budgets" element={<Budgets />} />
            <Route path="alerts" element={<Alerts />} />
          </Route>
          <Route element={<RoleGate allowedRoles={roles.orgAdmin} />}>
            <Route path="teams" element={<Teams />} />
            <Route path="users" element={<Users />} />
            <Route path="provider-keys" element={<ProviderKeys />} />
            <Route path="pricing" element={<Pricing />} />
          </Route>
          <Route element={<RoleGate allowedRoles={roles.orgTeamDeveloper} />}>
            <Route path="agents" element={<Agents />} />
          </Route>
          <Route element={<RoleGate allowedRoles={roles.developer} />}>
            <Route path="budget-requests" element={<Budgets requestOnly />} />
          </Route>
          <Route element={<RoleGate allowedRoles={roles.orgOrAuditor} />}>
            <Route path="audit-log" element={<AuditLog />} />
          </Route>
          <Route element={<RoleGate allowedRoles={roles.analytics} />}>
            <Route path="analytics" element={<Analytics />} />
            <Route path="analytics/costs" element={<Analytics />} />
          </Route>
          <Route element={<RoleGate allowedRoles={roles.all} />}>
            <Route path="notifications" element={<Notifications />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<HomeRedirect />} />
    </Routes>
  );
}

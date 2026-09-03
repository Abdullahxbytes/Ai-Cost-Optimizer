import { Navigate, Outlet } from 'react-router-dom';
import type { Role } from '../types/auth';
import { useAuthStore } from '../store/authStore';

export function RoleGate({ allowedRoles }: { allowedRoles: Role[] }) {
  const role = useAuthStore((state) => state.user?.role);
  return role && allowedRoles.includes(role) ? <Outlet /> : <Navigate to="/unauthorized" replace />;
}

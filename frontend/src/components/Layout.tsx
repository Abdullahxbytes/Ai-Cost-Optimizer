import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { api } from '../api/client';
import { itemsForRole } from '../config/navigation';
import { useAuthStore } from '../store/authStore';

type Notification = { id: string };
const navIcons: Record<string, string> = {
  'System Health': '◌', 'Org Management': '◫', 'Super Admin Management': '◆', Dashboard: '▦', Teams: '◇', Agents: '✦', 'My Agents': '✦', Budgets: '◒', Alerts: '!', Users: '◉', 'Provider Keys': '⌘', Pricing: '$', 'Audit Log': '≡', Savings: '↗', Analytics: '◔', 'My Budget Requests': '◒', Notifications: '•', 'Cost Overview': '◔', 'Budget Alerts': '!',
};

export function Layout() {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const navigate = useNavigate();
  const location = useLocation();
  const [profileOpen, setProfileOpen] = useState(false);
  const unread = useQuery({
    queryKey: ['notifications', user?.id, 'unread-count'],
    queryFn: async () => (await api.get<Notification[]>('/notifications?unreadOnly=true')).data,
    refetchInterval: 30_000,
  });
  if (!user) return null;
  const items = itemsForRole(user.role);
  const pageTitle = items.find((item) => item.to === location.pathname)?.label ?? 'Workspace';
  const initials = user.email.split('@')[0].split(/[._-]/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };
  return (
    <div className="app-shell min-h-screen md:flex">
      <aside className="app-sidebar md:min-h-screen md:w-64">
        <div className="px-5 py-5">
          <p className="text-lg font-medium">Workspace</p>
        </div>
        <nav
          className="flex flex-1 gap-1 overflow-x-auto px-3 pb-4 md:block md:space-y-1"
          aria-label="Main navigation"
        >
          {items.map((item) => (
            <NavLink
              key={`${item.label}-${item.to}`}
              to={item.to}
              className={({ isActive }) => `app-nav-link ${isActive ? 'app-nav-link-active' : ''}`}
            >
              <span aria-hidden="true" className="app-nav-icon">{navIcons[item.label] ?? '•'}</span>{item.label}
            </NavLink>
          ))}
        </nav>
        <div className="app-sidebar-profile">
          <button onClick={() => setProfileOpen((open) => !open)} className="app-sidebar-profile-button" aria-expanded={profileOpen}>
            <span className="app-sidebar-avatar">{initials}</span><span className="min-w-0 text-left"><span className="block truncate text-sm font-bold">{user.email}</span><span className="block text-xs capitalize text-[#CCC3BA]">{user.role.replace('_', ' ')}</span></span><span className="ml-auto">⌃</span>
          </button>
          {profileOpen && <div className="app-profile-menu"><button onClick={() => { setProfileOpen(false); navigate('/profile'); }}>Edit profile</button><button onClick={handleLogout}>Log out</button></div>}
        </div>
      </aside>
      <div className="app-main min-w-0 flex-1">
        <header className="app-topbar flex min-h-16 items-center justify-between gap-4 px-5 py-3 md:px-8">
          <h1 className="app-topbar-title">{pageTitle}</h1>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/notifications')}
              aria-label={`Notifications, ${unread.data?.length ?? 0} unread`}
              className="app-topbar-button relative px-3 py-2 text-sm"
            >
              Notifications
              {(unread.data?.length ?? 0) > 0 && (
                <span className="app-notification-count ml-2 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold">
                  {unread.data?.length}
                </span>
              )}
            </button>
          </div>
        </header>
        <main className="app-content p-5 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

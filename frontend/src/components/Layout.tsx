import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import {
  Bell,
  ChartDonut,
  ChartLineUp,
  Circle,
  CurrencyDollar,
  Gauge,
  Key,
  ListBullets,
  List,
  Robot,
  ShieldCheck,
  SquaresFour,
  SidebarSimple,
  UsersThree,
  Warning,
  Wallet,
  X,
} from '@phosphor-icons/react';
import { api } from '../api/client';
import { itemsForRole } from '../config/navigation';
import { useAuthStore } from '../store/authStore';

type Notification = { id: string };
const navIcons: Record<string, string> = {
  'System Health': '◌',
  'Org Management': '◫',
  'Super Admin Management': '◆',
  Dashboard: '▦',
  Teams: '◇',
  Agents: '✦',
  'My Agents': '✦',
  Budgets: '◒',
  Alerts: '!',
  Users: '◉',
  'Provider Keys': '⌘',
  Pricing: '$',
  'Audit Log': '≡',
  Savings: '↗',
  Analytics: '◔',
  'My Budget Requests': '◒',
  Notifications: '•',
  'Cost Overview': '◔',
  'Budget Alerts': '!',
};

const navIconComponents = {
  'System Health': ShieldCheck,
  'Org Management': SquaresFour,
  'Super Admin Management': UsersThree,
  Dashboard: Gauge,
  Teams: UsersThree,
  Agents: Robot,
  'My Agents': Robot,
  Budgets: Wallet,
  Alerts: Warning,
  Users: UsersThree,
  'Provider Keys': Key,
  Pricing: CurrencyDollar,
  'Audit Log': ListBullets,
  Savings: ChartLineUp,
  Analytics: ChartDonut,
  'My Budget Requests': Wallet,
  Notifications: Bell,
  'Cost Overview': ChartDonut,
  'Budget Alerts': Warning,
};

export function Layout() {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const navigate = useNavigate();
  const location = useLocation();
  const [profileOpen, setProfileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const unread = useQuery({
    queryKey: ['notifications', user?.id, 'unread-count'],
    queryFn: async () => (await api.get<Notification[]>('/notifications?unreadOnly=true')).data,
    refetchInterval: 30_000,
  });
  if (!user) return null;
  const items = itemsForRole(user.role);
  const pageTitle = items.find((item) => item.to === location.pathname)?.label ?? 'Workspace';
  const initials = user.email
    .split('@')[0]
    .split(/[._-]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };
  return (
    <div
      className={`app-shell min-h-screen ${sidebarCollapsed ? 'app-shell-sidebar-collapsed' : ''} ${mobileMenuOpen ? 'app-shell-mobile-menu-open' : ''}`}
    >
      <aside
        id="workspace-navigation"
        className={`app-sidebar ${sidebarCollapsed ? 'app-sidebar-collapsed' : ''}`}
        aria-label="Workspace navigation"
      >
        <div className="app-sidebar-heading">
          <p className="app-sidebar-title">Workspace</p>
          <button
            type="button"
            className="app-sidebar-toggle"
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
            aria-label={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            title={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
          >
            <SidebarSimple aria-hidden="true" size={19} weight="bold" />
          </button>
          <button
            type="button"
            className="app-mobile-menu-close"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close navigation"
          >
            <X aria-hidden="true" size={20} weight="bold" />
          </button>
        </div>
        <nav className="app-sidebar-nav" aria-label="Main navigation">
          {items.map((item) => {
            const Icon = navIconComponents[item.label as keyof typeof navIconComponents] ?? Circle;
            return (
              <NavLink
                key={`${item.label}-${item.to}`}
                to={item.to}
                onClick={() => setMobileMenuOpen(false)}
                className={({ isActive }) => `app-nav-link ${isActive ? 'app-nav-link-active' : ''}`}
                title={sidebarCollapsed ? item.label : undefined}
              >
                <Icon aria-hidden="true" className="app-nav-phosphor" size={19} weight="duotone" />
                <span aria-hidden="true" className="app-nav-icon">
                  {navIcons[item.label] ?? '•'}
                </span>
                <span className="app-nav-label">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
        <div className="app-sidebar-profile">
          <button
            onClick={() => setProfileOpen((open) => !open)}
            className="app-sidebar-profile-button"
            aria-expanded={profileOpen}
          >
            <span className="app-sidebar-avatar">{initials}</span>
            <span className="app-profile-copy min-w-0 text-left">
              <span className="block truncate text-sm font-bold">{user.email}</span>
              <span className="block text-xs capitalize text-[#CCC3BA]">{user.role.replace('_', ' ')}</span>
            </span>
            <span className="ml-auto">⌃</span>
          </button>
          {profileOpen && (
            <div className="app-profile-menu">
              <button
                onClick={() => {
                  setProfileOpen(false);
                  navigate('/profile');
                }}
              >
                Edit profile
              </button>
              <button onClick={handleLogout}>Log out</button>
            </div>
          )}
        </div>
      </aside>
      <button
        type="button"
        className="app-mobile-nav-backdrop"
        aria-label="Close navigation"
        onClick={() => setMobileMenuOpen(false)}
        tabIndex={mobileMenuOpen ? 0 : -1}
      />
      <div className={`app-main min-w-0 flex-1 ${sidebarCollapsed ? 'app-main-sidebar-collapsed' : ''}`}>
        <header className="app-topbar flex min-h-16 items-center justify-between gap-4 px-5 py-3 md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              className="app-mobile-menu-trigger"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation"
              aria-controls="workspace-navigation"
              aria-expanded={mobileMenuOpen}
            >
              <List aria-hidden="true" size={21} weight="bold" />
            </button>
            <h1 className="app-topbar-title">{pageTitle}</h1>
          </div>
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

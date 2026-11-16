import { Briefcase, ChartNoAxesColumn, FileText, History, LayoutDashboard, LogOut, Map as MapIcon, MessageSquare, Plus, UserRound, Users, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";
import { Brand } from "../components/Brand";
import { Avatar } from "../components/ui";
import { AiStatusPill } from "../features/admin/AiStatusPill";
import { useAuth, useCurrentUser } from "../features/auth/AuthContext";
import { NotificationBell, NotificationBellLink } from "../features/notifications/NotificationBell";
import { NotificationsProvider } from "../features/notifications/NotificationsContext";
import type { UserRole } from "../lib/types";
import { roleLabel } from "../utils/format";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles: readonly UserRole[];
  /** Shown in the mobile tab bar (at most five per role). The rest stay reachable from the top bar. */
  tab: boolean;
}

/** Navigation only shows what a role may use; the backend enforces the same rules. */
const NAV_ITEMS: readonly NavItem[] = [
  { to: "/reports", label: "My reports", icon: FileText, roles: ["CITIZEN"], tab: true },
  { to: "/reports/new", label: "Report damage", icon: Plus, roles: ["CITIZEN"], tab: true },
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, roles: ["ADMIN"], tab: true },
  { to: "/admin/reports", label: "Reports", icon: FileText, roles: ["ADMIN"], tab: true },
  { to: "/admin/map", label: "Map", icon: MapIcon, roles: ["ADMIN"], tab: true },
  { to: "/admin/analytics", label: "Analytics", icon: ChartNoAxesColumn, roles: ["ADMIN"], tab: false },
  { to: "/admin/engineers", label: "Engineers", icon: Users, roles: ["ADMIN"], tab: true },
  { to: "/engineer", label: "My jobs", icon: Briefcase, roles: ["ENGINEER"], tab: true },
  { to: "/engineer/history", label: "History", icon: History, roles: ["ENGINEER"], tab: true },
  { to: "/chat", label: "Messages", icon: MessageSquare, roles: ["ADMIN", "ENGINEER"], tab: true },
  { to: "/profile", label: "Profile", icon: UserRound, roles: ["CITIZEN", "ENGINEER"], tab: true },
  { to: "/profile", label: "Profile", icon: UserRound, roles: ["ADMIN"], tab: false },
];

/**
 * The item for the current page: the one whose path is the longest prefix of the URL, so
 * "/admin/reports/123" highlights Reports (not Dashboard) and "/reports/new" highlights
 * Report damage (not My reports).
 */
function activePath(items: readonly NavItem[], pathname: string): string | undefined {
  return items
    .map((item) => item.to)
    .filter((to) => pathname === to || pathname.startsWith(`${to}/`))
    .sort((a, b) => b.length - a.length)[0];
}

/**
 * Logged-in shell. Desktop: fixed ink sidebar. Phone and tablet: ink top bar plus a bottom tab
 * bar within thumb reach. The same component serves all three roles; only the items differ.
 */
export function AppLayout() {
  const user = useCurrentUser();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [loggingOut, setLoggingOut] = useState(false);
  const items = NAV_ITEMS.filter((item) => item.roles.includes(user.role));
  const active = activePath(items, pathname);
  const tabs = items.filter((item) => item.tab);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      navigate("/login", { replace: true });
    }
  }

  return (
    <NotificationsProvider>
    <div className="min-h-screen lg:pl-60">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[1200] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-semibold">
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col gap-6 bg-ink-900 px-3.5 py-5 lg:flex">
        <Link to="/" className="rounded-lg px-2">
          <Brand onDark />
        </Link>
        <nav className="flex flex-col gap-0.5" aria-label="Main">
          {items.map((item) => {
            const current = item.to === active;
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={current ? "page" : undefined}
                className={`flex min-h-10 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium transition-colors ${
                  current ? "bg-ink-800 text-white shadow-[inset_3px_0_0_var(--color-road-400)]" : "text-ink-on-dark hover:bg-ink-800 hover:text-white"
                }`}
              >
                <item.icon className="size-[18px]" strokeWidth={1.6} aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto border-t border-ink-700 pt-4">
          <div className="flex items-center gap-2.5 px-2">
            <Avatar name={user.fullName} dark />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-[13px] font-semibold text-white">{user.fullName}</div>
              <div className="text-[11px] text-ink-on-dark">{roleLabel[user.role]}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleLogout()}
            disabled={loggingOut}
            className="mt-3 flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium text-ink-on-dark transition-colors hover:bg-ink-800 hover:text-white disabled:opacity-60"
          >
            <LogOut className="size-[18px]" strokeWidth={1.6} aria-hidden="true" />
            Log out
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 bg-ink-900 px-4 lg:hidden">
        <Link to="/" className="rounded-lg">
          <Brand onDark showTagline={false} />
        </Link>
        <div className="flex items-center gap-1">
          <NotificationBellLink />
          <Link to="/profile" aria-label={`Profile: ${user.fullName}`} className="flex size-11 items-center justify-center rounded-lg">
            <Avatar name={user.fullName} dark />
          </Link>
          <button
            type="button"
            onClick={() => void handleLogout()}
            disabled={loggingOut}
            aria-label="Log out"
            className="flex size-11 items-center justify-center rounded-lg text-ink-on-dark hover:bg-ink-800 hover:text-white disabled:opacity-60"
          >
            <LogOut className="size-5" strokeWidth={1.6} aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Desktop top bar: system status (admins) and notifications */}
      <div className="sticky top-0 z-20 hidden h-14 items-center justify-end gap-3 border-b border-ink-150 bg-white px-8 lg:flex">
        {user.role === "ADMIN" && <AiStatusPill />}
        <NotificationBell />
      </div>

      <main id="main" className="mx-auto w-full max-w-7xl px-4 pt-6 pb-28 sm:px-6 lg:px-8 lg:pt-8 lg:pb-12">
        <Outlet />
      </main>

      {/* Mobile tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-ink-150 bg-white px-2 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:hidden" aria-label="Main">
        {tabs.map((item) => {
          const current = item.to === active;
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-current={current ? "page" : undefined}
              className={`flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg text-[11px] font-semibold ${
                current ? "text-cobalt-600" : "text-ink-500"
              }`}
            >
              <item.icon className="size-[22px]" strokeWidth={1.6} aria-hidden="true" />
              <span className="max-w-full truncate px-1">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
    </NotificationsProvider>
  );
}

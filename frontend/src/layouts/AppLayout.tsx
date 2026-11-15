import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { Button } from "../components/ui";
import { useAuth, useCurrentUser } from "../features/auth/AuthContext";
import type { UserRole } from "../lib/types";
import { roleLabel } from "../utils/format";

interface NavItem {
  to: string;
  label: string;
  roles: readonly UserRole[];
  /** Highlight only on this exact path (not on sub-pages). */
  end?: boolean;
}

/** Navigation only shows what a role may use; the backend enforces the same rules. */
const NAV_ITEMS: readonly NavItem[] = [
  { to: "/reports", label: "My reports", roles: ["CITIZEN"] },
  { to: "/admin", label: "Dashboard", roles: ["ADMIN"], end: true },
  { to: "/admin/reports", label: "Reports", roles: ["ADMIN"] },
  { to: "/admin/engineers", label: "Engineers", roles: ["ADMIN"] },
  { to: "/engineer", label: "My jobs", roles: ["ENGINEER"], end: true },
  { to: "/engineer/history", label: "History", roles: ["ENGINEER"] },
  { to: "/profile", label: "My profile", roles: ["CITIZEN", "ADMIN", "ENGINEER"] },
];

export function AppLayout() {
  const user = useCurrentUser();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const items = NAV_ITEMS.filter((item) => item.roles.includes(user.role));

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      navigate("/login", { replace: true });
    }
  }

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `block rounded-md px-3 py-2 text-sm font-medium transition ${isActive ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`;

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-6">
            <NavLink to="/" className="flex items-center gap-2 font-semibold text-slate-900">
              <span className="flex size-8 items-center justify-center rounded-lg bg-blue-600 font-bold text-white" aria-hidden="true">
                R
              </span>
              <span className="hidden sm:inline">Road Damage Reporting</span>
            </NavLink>
            <nav className="hidden gap-1 md:flex" aria-label="Main">
              {items.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end === true} className={linkClass}>
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="hidden items-center gap-3 md:flex">
            <div className="text-right text-sm leading-tight">
              <div className="font-medium text-slate-900">{user.fullName}</div>
              <div className="text-slate-500">{roleLabel[user.role]}</div>
            </div>
            <Button variant="secondary" onClick={() => void handleLogout()} loading={loggingOut}>
              Log out
            </Button>
          </div>
          <button
            type="button"
            className="rounded-md p-2 text-slate-600 hover:bg-slate-100 md:hidden"
            aria-expanded={menuOpen}
            aria-label="Toggle menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <svg className="size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" d={menuOpen ? "M6 6l12 12M18 6L6 18" : "M4 7h16M4 12h16M4 17h16"} />
            </svg>
          </button>
        </div>
        {menuOpen && (
          <div className="border-t border-slate-100 px-4 py-3 md:hidden">
            <nav className="space-y-1" aria-label="Main">
              {items.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end === true} className={linkClass} onClick={() => setMenuOpen(false)}>
                  {item.label}
                </NavLink>
              ))}
            </nav>
            <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
              <div className="text-sm">
                <div className="font-medium text-slate-900">{user.fullName}</div>
                <div className="text-slate-500">{roleLabel[user.role]}</div>
              </div>
              <Button variant="secondary" onClick={() => void handleLogout()} loading={loggingOut}>
                Log out
              </Button>
            </div>
          </div>
        )}
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}

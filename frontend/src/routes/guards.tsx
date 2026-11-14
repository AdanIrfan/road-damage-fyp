import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { FullPageSpinner } from "../components/ui";
import { useAuth } from "../features/auth/AuthContext";
import type { User, UserRole } from "../lib/types";

/** Where each role lands after logging in. */
export function homePathFor(user: User): string {
  if (user.role === "ADMIN") return "/admin/engineers";
  if (user.role === "CITIZEN") return "/reports";
  return "/profile";
}

/** Logged-in users only. Accounts with a temporary password are sent to change it first. */
export function RequireAuth() {
  const { state } = useAuth();
  const location = useLocation();
  if (state.status === "loading") return <FullPageSpinner />;
  if (state.status === "anonymous") {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }
  if (state.user.mustChangePassword && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }
  return <Outlet />;
}

/**
 * Hides pages from roles that may not use them. This is for user experience only:
 * the backend independently rejects requests from the wrong role.
 */
export function RequireRole({ roles, children }: { roles: readonly UserRole[]; children?: ReactNode }) {
  const { state } = useAuth();
  if (state.status !== "authenticated") return <FullPageSpinner />;
  if (!roles.includes(state.user.role)) return <Navigate to={homePathFor(state.user)} replace />;
  return children ?? <Outlet />;
}

/** Login, registration and verification: logged-in users are sent to their home page. */
export function PublicOnly() {
  const { state } = useAuth();
  if (state.status === "loading") return <FullPageSpinner />;
  if (state.status === "authenticated") return <Navigate to={homePathFor(state.user)} replace />;
  return <Outlet />;
}

export function HomeRedirect() {
  const { state } = useAuth();
  if (state.status !== "authenticated") return <FullPageSpinner />;
  return <Navigate to={homePathFor(state.user)} replace />;
}

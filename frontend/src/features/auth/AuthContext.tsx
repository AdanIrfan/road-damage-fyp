import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, onSessionEnded } from "../../lib/api";
import type { User } from "../../lib/types";
import { authApi } from "./authApi";

type AuthState = { status: "loading"; user: null } | { status: "authenticated"; user: User } | { status: "anonymous"; user: null };

interface AuthContextValue {
  state: AuthState;
  login: (mobileNumber: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  /** Replace the stored user after the server returned an updated copy. */
  setUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * Holds who is logged in. The session itself lives in httpOnly cookies; on page load the
 * provider asks the backend (GET /auth/me, refreshing the session if needed).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading", user: null });

  useEffect(() => {
    let cancelled = false;
    authApi
      .me()
      .then(({ user }) => {
        if (!cancelled) setState({ status: "authenticated", user });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: "anonymous", user: null });
        if (!(error instanceof ApiError && error.status === 401)) {
          console.error("Could not load the session", error);
        }
      });
    const unsubscribe = onSessionEnded(() => setState({ status: "anonymous", user: null }));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const login = useCallback(async (mobileNumber: string, password: string) => {
    const { user } = await authApi.login(mobileNumber, password);
    setState({ status: "authenticated", user });
    return user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setState({ status: "anonymous", user: null });
    }
  }, []);

  const setUser = useCallback((user: User) => setState({ status: "authenticated", user }), []);

  const value = useMemo(() => ({ state, login, logout, setUser }), [state, login, logout, setUser]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return context;
}

/** For components rendered only inside protected routes. */
export function useCurrentUser(): User {
  const { state } = useAuth();
  if (state.status !== "authenticated") {
    throw new Error("useCurrentUser used outside an authenticated route");
  }
  return state.user;
}

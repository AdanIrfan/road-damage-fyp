import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { notificationsApi } from "../../lib/notificationsApi";

interface NotificationsValue {
  /** Unread notifications of the logged-in user. */
  unread: number;
  /** Ask the server again now (after an action that may have created or read notifications). */
  refresh: () => void;
  /** Use a count the server just returned (mark read / mark all). */
  setUnread: (count: number) => void;
}

const NotificationsContext = createContext<NotificationsValue | undefined>(undefined);

const POLL_INTERVAL_MS = 30_000;

/**
 * Keeps the unread count current: asks every 30 seconds while the tab is visible, and again
 * whenever the tab regains focus. Polling (not a socket) is deliberate: it works the same for
 * all three roles and needs no extra infrastructure. A failed poll is ignored; the next one
 * simply tries again (the API client already handles an expired session).
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(() => {
    notificationsApi
      .unreadCount()
      .then((result) => setUnread(result.unread))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);

  const value = useMemo(() => ({ unread, refresh, setUnread }), [unread, refresh]);
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications(): NotificationsValue {
  const context = useContext(NotificationsContext);
  if (context === undefined) {
    throw new Error("useNotifications must be used inside <NotificationsProvider>");
  }
  return context;
}

import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "../../lib/api";
import { notificationsApi, type AppNotification, type NotificationPage } from "../../lib/notificationsApi";
import { useNotifications } from "./NotificationsContext";

/** Loads one page of notifications and keeps it in step with read actions and the unread badge. */
export function useNotificationList(page: number, pageSize: number, enabled = true) {
  const { unread, setUnread } = useNotifications();
  const [data, setData] = useState<NotificationPage>();
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const result = await notificationsApi.list(page, pageSize);
      setData(result);
      setUnread(result.unread);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, setUnread]);

  // Reloads when opened and whenever the polled unread count changes (something new arrived).
  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load, unread]);

  const markRead = useCallback(
    (notification: AppNotification) => {
      if (notification.readAt !== null) return;
      const readAt = new Date().toISOString();
      setData((current) =>
        current === undefined ? current : { ...current, items: current.items.map((n) => (n.id === notification.id ? { ...n, readAt } : n)) },
      );
      notificationsApi
        .markRead(notification.id)
        .then((result) => setUnread(result.unread))
        .catch(() => undefined);
    },
    [setUnread],
  );

  const markAllRead = useCallback(async () => {
    try {
      const result = await notificationsApi.markAllRead();
      const readAt = new Date().toISOString();
      setData((current) => (current === undefined ? current : { ...current, unread: 0, items: current.items.map((n) => ({ ...n, readAt: n.readAt ?? readAt })) }));
      setUnread(result.unread);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [setUnread]);

  return { data, loading, error, reload: load, markRead, markAllRead };
}

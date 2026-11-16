import { Bell, BellOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { EmptyState, SkeletonList } from "../../components/ui";
import { useCurrentUser } from "../auth/AuthContext";
import { NotificationItem } from "./NotificationItem";
import { useNotifications } from "./NotificationsContext";
import { useNotificationList } from "./useNotificationList";

const DROPDOWN_SIZE = 8;

function countLabel(unread: number): string {
  return unread > 99 ? "99+" : String(unread);
}

function BellIcon({ unread, onDark }: { unread: number; onDark: boolean }) {
  return (
    <>
      <Bell className="size-[18px]" strokeWidth={1.6} aria-hidden="true" />
      {unread > 0 && (
        <span
          aria-hidden="true"
          className={`absolute -top-1.5 -right-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold ${
            onDark ? "bg-road-400 text-ink-900" : "bg-cobalt-600 text-white ring-2 ring-white"
          }`}
        >
          {countLabel(unread)}
        </span>
      )}
    </>
  );
}

/** Phone and tablet: the bell opens the notifications page. */
export function NotificationBellLink() {
  const { unread } = useNotifications();
  return (
    <Link
      to="/notifications"
      aria-label={unread === 0 ? "Notifications" : `Notifications, ${unread} unread`}
      className="relative flex size-11 items-center justify-center rounded-lg text-white hover:bg-ink-800"
    >
      <span className="relative">
        <BellIcon unread={unread} onDark />
      </span>
    </Link>
  );
}

/** Desktop: the bell opens a dropdown with the latest notifications. */
export function NotificationBell() {
  const user = useCurrentUser();
  const { unread } = useNotifications();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { data, loading, error, markRead, markAllRead } = useNotificationList(1, DROPDOWN_SIZE, open);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (containerRef.current !== null && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={unread === 0 ? "Notifications" : `Notifications, ${unread} unread`}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((value) => !value)}
        className={`relative flex size-10 items-center justify-center rounded-lg border text-ink-900 transition-colors ${
          open ? "border-cobalt-600 bg-cobalt-50" : "border-ink-200 bg-white hover:bg-ink-100"
        }`}
      >
        <BellIcon unread={unread} onDark={false} />
      </button>
      {open && (
        <section
          aria-label="Notifications"
          className="absolute top-12 right-0 z-[1050] flex max-h-[min(34rem,calc(100vh-5rem))] w-[26rem] flex-col overflow-hidden rounded-xl border border-ink-200 bg-white shadow-[0_12px_32px_rgba(14,26,43,0.14)]"
        >
          <header className="flex items-center justify-between border-b border-ink-150 px-4 py-3">
            <h2 className="text-base font-bold text-ink-900">
              Notifications{unread > 0 && <span className="text-[13px] font-medium text-ink-500"> · {unread} unread</span>}
            </h2>
            <button
              type="button"
              disabled={unread === 0}
              onClick={() => void markAllRead()}
              className="min-h-9 rounded-lg px-1 text-[13px] font-semibold text-cobalt-600 hover:text-cobalt-700 disabled:text-ink-400"
            >
              Mark all as read
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {error !== undefined ? (
              <p className="px-4 py-6 text-sm text-danger-700">{error}</p>
            ) : data === undefined && loading ? (
              <div className="p-4">
                <SkeletonList rows={4} />
              </div>
            ) : data !== undefined && data.items.length === 0 ? (
              <EmptyState icon={<BellOff className="size-6" />} title="No notifications yet" />
            ) : (
              <ul className="divide-y divide-ink-100">
                {data?.items.map((notification) => (
                  <li key={notification.id}>
                    <NotificationItem
                      notification={notification}
                      role={user.role}
                      dense
                      onOpen={(item) => {
                        markRead(item);
                        setOpen(false);
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Link
            to="/notifications"
            onClick={() => setOpen(false)}
            className="flex min-h-11 items-center justify-center border-t border-ink-150 text-[13px] font-semibold text-cobalt-600 hover:text-cobalt-700"
          >
            View all notifications
          </Link>
        </section>
      )}
    </div>
  );
}

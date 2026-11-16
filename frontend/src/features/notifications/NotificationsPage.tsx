import { BellOff } from "lucide-react";
import { useState } from "react";
import { Pagination } from "../../components/Pagination";
import { Alert, Button, EmptyState, PageHeader, SkeletonList } from "../../components/ui";
import { useCurrentUser } from "../auth/AuthContext";
import { NotificationItem } from "./NotificationItem";
import { useNotificationList } from "./useNotificationList";

const PAGE_SIZE = 20;

/** The full notification list for any role (the phone view, and "View all" on desktop). */
export function NotificationsPage() {
  const user = useCurrentUser();
  const [page, setPage] = useState(1);
  const { data, loading, error, markRead, markAllRead } = useNotificationList(page, PAGE_SIZE);
  const [marking, setMarking] = useState(false);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader
        title="Notifications"
        description={data === undefined ? undefined : data.unread === 0 ? "You are up to date." : `${data.unread} unread`}
        actions={
          <Button
            variant="secondary"
            loading={marking}
            disabled={data === undefined || data.unread === 0}
            onClick={() => {
              setMarking(true);
              void markAllRead().finally(() => setMarking(false));
            }}
          >
            Mark all as read
          </Button>
        }
      />
      {error !== undefined && <Alert>{error}</Alert>}
      <section className="overflow-hidden rounded-xl border border-ink-150 bg-white">
        {data === undefined && loading ? (
          <div className="p-5">
            <SkeletonList rows={5} />
          </div>
        ) : data !== undefined && data.items.length === 0 ? (
          <EmptyState icon={<BellOff className="size-6" />} title="No notifications yet" description="Updates about your reports, jobs and messages will appear here." />
        ) : (
          <ul className={`divide-y divide-ink-100 ${loading ? "opacity-60" : ""}`}>
            {data?.items.map((notification) => (
              <li key={notification.id}>
                <NotificationItem notification={notification} role={user.role} onOpen={markRead} />
              </li>
            ))}
          </ul>
        )}
      </section>
      {data !== undefined && data.total > PAGE_SIZE && (
        <Pagination page={data.page} pageSize={data.pageSize} total={data.total} loading={loading} noun="notification" onPage={setPage} />
      )}
    </div>
  );
}

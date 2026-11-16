import {
  Briefcase,
  CircleCheck,
  CircleX,
  Clock,
  FileText,
  MessageSquare,
  Repeat,
  RotateCcw,
  TriangleAlert,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router";
import { reportRef } from "../../components/reports/indicators";
import type { AppNotification, NotificationType } from "../../lib/notificationsApi";
import type { UserRole } from "../../lib/types";

const ICONS: Record<NotificationType, LucideIcon> = {
  REPORT_SUBMITTED: FileText,
  REPORT_ACCEPTED: CircleCheck,
  REPORT_REJECTED: CircleX,
  REPORT_DELAYED: Clock,
  REPAIR_STARTED: Wrench,
  REPAIR_UPDATED: Wrench,
  REPAIR_CONFIRMED: CircleCheck,
  NEW_REPORT: FileText,
  AI_ANALYSIS_FAILED: TriangleAlert,
  REPAIR_AWAITING_CONFIRMATION: CircleCheck,
  JOB_ASSIGNED: Briefcase,
  JOB_REASSIGNED: Repeat,
  REWORK_REQUESTED: RotateCcw,
  CHAT_MESSAGE: MessageSquare,
};

/** Where a notification leads for this role, or undefined when there is nothing to open. */
export function notificationHref(notification: AppNotification, role: UserRole): string | undefined {
  if (notification.conversationId !== null) {
    return notification.chatWithUserId === null ? "/chat" : `/chat?with=${encodeURIComponent(notification.chatWithUserId)}`;
  }
  if (notification.reportId !== null) {
    const id = encodeURIComponent(notification.reportId);
    if (role === "ADMIN") return `/admin/reports/${id}`;
    if (role === "ENGINEER") return `/engineer/jobs/${id}`;
    return `/reports/${id}`;
  }
  return undefined;
}

/** "12 min ago", "Yesterday", or a date. */
export function relativeTime(iso: string): string {
  const then = new Date(iso);
  const minutes = Math.floor((Date.now() - then.getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  if (hours < 48) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(then);
}

/**
 * One notification row. Unread rows have a dot, a bold title and a tinted background (never
 * colour alone). The whole row is a link when there is something to open; otherwise a button
 * that just marks it read.
 */
export function NotificationItem({
  notification,
  role,
  onOpen,
  dense = false,
}: {
  notification: AppNotification;
  role: UserRole;
  onOpen: (notification: AppNotification) => void;
  dense?: boolean;
}) {
  const unread = notification.readAt === null;
  const href = notificationHref(notification, role);
  const Icon = ICONS[notification.type];
  const reference = notification.reportId !== null ? reportRef(notification.reportId) : notification.conversationId !== null ? "Messages" : null;
  const className = `flex w-full items-start gap-2.5 text-left transition-colors hover:bg-ink-100 ${dense ? "px-3 py-3" : "px-4 py-3.5"} ${
    unread ? "bg-cobalt-50" : "bg-white"
  }`;
  const content = (
    <>
      <span className={`mt-3.5 size-2 shrink-0 rounded-full ${unread ? "bg-cobalt-600" : "bg-transparent"}`} aria-hidden="true" />
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-ink-100 text-ink-900" aria-hidden="true">
        <Icon className="size-[18px]" strokeWidth={1.6} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-sm text-ink-900 ${unread ? "font-bold" : "font-medium"}`}>
          {notification.title}
          {unread && <span className="sr-only"> (unread)</span>}
        </span>
        <span className="block text-[13px] break-words text-ink-600">{notification.body}</span>
        <span className="mt-1 flex gap-2 text-xs text-ink-500">
          {reference !== null && <span className="font-mono">{reference}</span>}
          <span>{relativeTime(notification.createdAt)}</span>
        </span>
      </span>
    </>
  );
  return href !== undefined ? (
    <Link to={href} onClick={() => onOpen(notification)} className={className}>
      {content}
    </Link>
  ) : (
    <button type="button" onClick={() => onOpen(notification)} className={className}>
      {content}
    </button>
  );
}

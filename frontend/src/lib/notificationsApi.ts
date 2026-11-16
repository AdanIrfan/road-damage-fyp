import { api } from "./api";

/** Mirrors backend/api/src/services/inAppNotification.service.ts. */
export type NotificationType =
  | "REPORT_SUBMITTED"
  | "REPORT_ACCEPTED"
  | "REPORT_REJECTED"
  | "REPORT_DELAYED"
  | "REPAIR_STARTED"
  | "REPAIR_UPDATED"
  | "REPAIR_CONFIRMED"
  | "NEW_REPORT"
  | "AI_ANALYSIS_FAILED"
  | "REPAIR_AWAITING_CONFIRMATION"
  | "JOB_ASSIGNED"
  | "JOB_REASSIGNED"
  | "REWORK_REQUESTED"
  | "CHAT_MESSAGE";

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  reportId: string | null;
  conversationId: string | null;
  chatWithUserId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPage {
  items: AppNotification[];
  page: number;
  pageSize: number;
  total: number;
  unread: number;
}

export const notificationsApi = {
  list: (page = 1, pageSize = 20) => api.get<NotificationPage>(`/api/v1/notifications?page=${page}&pageSize=${pageSize}`),
  unreadCount: () => api.get<{ unread: number }>("/api/v1/notifications/unread-count"),
  markRead: (id: string) => api.post<{ unread: number }>(`/api/v1/notifications/${encodeURIComponent(id)}/read`),
  markAllRead: () => api.post<{ unread: number }>("/api/v1/notifications/read-all"),
  markConversationRead: (conversationId: string) =>
    api.post<{ unread: number }>(`/api/v1/notifications/conversations/${encodeURIComponent(conversationId)}/read`),
};

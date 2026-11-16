import type { PrismaClient } from "../db/prisma.js";
import type { NotificationType, UserRole } from "../generated/prisma/client.js";
import { HttpError } from "../utils/httpError.js";
import type { Clock } from "./clock.js";

/**
 * Reading side of in-app notifications (Phase 6). Rows are created by notificationEvents.ts inside
 * the business transactions. Every query here is scoped to the caller's own user id; another
 * user's notification id answers 404 (no existence leak).
 *
 * Not to be confused with notification.service.ts, which sends the citizen status SMS.
 */
export interface NotificationView {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Report to open, if the recipient may still open it. */
  reportId: string | null;
  conversationId: string | null;
  /** For chat notifications: the other member of the conversation (for /chat?with=<id>). */
  chatWithUserId: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export interface NotificationList {
  items: NotificationView[];
  page: number;
  pageSize: number;
  total: number;
  unread: number;
}

export interface NotificationUser {
  id: string;
  role: UserRole;
}

export interface InAppNotificationService {
  list(user: NotificationUser, query: { page: number; pageSize: number }): Promise<NotificationList>;
  unreadCount(userId: string): Promise<number>;
  markRead(userId: string, notificationId: string): Promise<void>;
  markAllRead(userId: string): Promise<number>;
  /** Called when the user opens a conversation: its (single) chat notification becomes read. */
  markConversationRead(userId: string, conversationId: string): Promise<void>;
}

const notificationSelect = {
  id: true,
  type: true,
  title: true,
  body: true,
  reportId: true,
  conversationId: true,
  readAt: true,
  createdAt: true,
  conversation: { select: { adminId: true, engineerId: true } },
} as const;

export function createInAppNotificationService(deps: { prisma: PrismaClient; clock: Clock }): InAppNotificationService {
  const { prisma, clock } = deps;

  return {
    list: async (user, { page, pageSize }) => {
      const where = { userId: user.id };
      const [rows, total, unread] = await Promise.all([
        prisma.notification.findMany({
          where,
          select: notificationSelect,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.notification.count({ where }),
        prisma.notification.count({ where: { userId: user.id, readAt: null } }),
      ]);
      const items = rows.map(({ conversation, ...row }) => ({
        ...row,
        chatWithUserId: conversation === null ? null : conversation.adminId === user.id ? conversation.engineerId : conversation.adminId,
      }));
      return { items, page, pageSize, total, unread };
    },

    unreadCount: (userId) => prisma.notification.count({ where: { userId, readAt: null } }),

    markRead: async (userId, notificationId) => {
      // Scoped by owner: someone else's id matches nothing.
      const updated = await prisma.notification.updateMany({ where: { id: notificationId, userId, readAt: null }, data: { readAt: clock() } });
      if (updated.count === 0) {
        const exists = await prisma.notification.count({ where: { id: notificationId, userId } });
        if (exists === 0) {
          throw new HttpError(404, "NOTIFICATION_NOT_FOUND", "Notification not found.");
        }
      }
    },

    markAllRead: async (userId) => {
      const updated = await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: clock() } });
      return updated.count;
    },

    markConversationRead: async (userId, conversationId) => {
      await prisma.notification.updateMany({ where: { userId, conversationId, readAt: null }, data: { readAt: clock() } });
    },
  };
}

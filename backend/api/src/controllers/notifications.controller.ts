import type { RequestHandler } from "express";
import { getAuthUser } from "../middleware/auth.js";
import type { InAppNotificationService } from "../services/inAppNotification.service.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { parseInput } from "../utils/validation.js";
import { conversationIdParamsSchema, listNotificationsQuerySchema, notificationIdParamsSchema } from "../validation/schemas.js";

export interface NotificationsController {
  list: RequestHandler;
  unreadCount: RequestHandler;
  markRead: RequestHandler;
  markAllRead: RequestHandler;
  markConversationRead: RequestHandler;
}

/** Any logged-in role. Every call acts only on the caller's own notifications (enforced in the service). */
export function createNotificationsController(deps: { notifications: InAppNotificationService }): NotificationsController {
  const { notifications } = deps;

  return {
    list: async (req, res) => {
      const user = getAuthUser(req);
      sendSuccess(res, await notifications.list({ id: user.id, role: user.role }, parseInput(listNotificationsQuerySchema, req.query)));
    },

    unreadCount: async (req, res) => {
      sendSuccess(res, { unread: await notifications.unreadCount(getAuthUser(req).id) });
    },

    markRead: async (req, res) => {
      const userId = getAuthUser(req).id;
      await notifications.markRead(userId, parseInput(notificationIdParamsSchema, req.params).id);
      sendSuccess(res, { unread: await notifications.unreadCount(userId) });
    },

    markAllRead: async (req, res) => {
      await notifications.markAllRead(getAuthUser(req).id);
      sendSuccess(res, { unread: 0 });
    },

    markConversationRead: async (req, res) => {
      const userId = getAuthUser(req).id;
      await notifications.markConversationRead(userId, parseInput(conversationIdParamsSchema, req.params).id);
      sendSuccess(res, { unread: await notifications.unreadCount(userId) });
    },
  };
}

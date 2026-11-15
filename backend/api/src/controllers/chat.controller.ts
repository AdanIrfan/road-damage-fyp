import type { RequestHandler } from "express";
import { getAuthUser } from "../middleware/auth.js";
import type { ChatService } from "../services/chat.service.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { parseInput } from "../utils/validation.js";
import { chatHistoryQuerySchema, conversationIdParamsSchema, openConversationSchema } from "../validation/schemas.js";

export interface ChatController {
  contacts: RequestHandler;
  conversations: RequestHandler;
  open: RequestHandler;
  messages: RequestHandler;
}

/**
 * ADMIN and ENGINEER only (enforced by the router). Membership of each conversation is enforced in
 * the service. Messages are SENT over the WebSocket (realtime/chatGateway.ts); REST serves history.
 */
export function createChatController(deps: { chat: ChatService }): ChatController {
  const { chat } = deps;
  const me = (req: Parameters<RequestHandler>[0]) => {
    const user = getAuthUser(req);
    return { id: user.id, role: user.role };
  };

  return {
    contacts: async (req, res) => {
      sendSuccess(res, { contacts: await chat.contacts(me(req)) });
    },

    conversations: async (req, res) => {
      sendSuccess(res, { conversations: await chat.conversations(me(req)) });
    },

    open: async (req, res) => {
      const { userId } = parseInput(openConversationSchema, req.body);
      sendSuccess(res, { conversation: await chat.openConversation(me(req), userId) });
    },

    messages: async (req, res) => {
      const { id } = parseInput(conversationIdParamsSchema, req.params);
      const query = parseInput(chatHistoryQuerySchema, req.query);
      sendSuccess(res, await chat.messages(me(req), id, query));
    },
  };
}

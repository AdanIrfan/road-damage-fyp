import { api } from "../../lib/api";
import type { ChatContact, Conversation, MessagePage } from "../../lib/chatTypes";

/** REST part of chat: contacts, conversations and history. Messages are sent over the WebSocket. */
export const chatApi = {
  contacts: () => api.get<{ contacts: ChatContact[] }>("/api/v1/chat/contacts"),
  conversations: () => api.get<{ conversations: Conversation[] }>("/api/v1/chat/conversations"),
  open: (userId: string) => api.post<{ conversation: Conversation }>("/api/v1/chat/conversations", { userId }),
  messages: (conversationId: string, cursor: { after?: string; before?: string } = {}, limit = 50) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor.after !== undefined) params.set("after", cursor.after);
    if (cursor.before !== undefined) params.set("before", cursor.before);
    return api.get<MessagePage>(`/api/v1/chat/conversations/${encodeURIComponent(conversationId)}/messages?${params.toString()}`);
  },
};

import type { AccountStatus, UserRole } from "./types";

/** Mirrors the backend's chat views (src/services/chat.service.ts). Dates are ISO strings. */

export interface ChatContact {
  id: string;
  fullName: string;
  role: UserRole;
  status: AccountStatus;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  clientId: string;
  body: string;
  createdAt: string;
}

export interface Conversation {
  id: string;
  contact: ChatContact;
  lastMessageAt: string | null;
  lastMessage: ChatMessage | null;
  createdAt: string;
}

export interface MessagePage {
  messages: ChatMessage[];
  hasMore: boolean;
}

/** Same limit as the backend (CHAT_MESSAGE_MAX_LENGTH). */
export const CHAT_MESSAGE_MAX_LENGTH = 2000;

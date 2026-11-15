import { CHAT_HISTORY_DEFAULT_LIMIT } from "../config/chat.js";
import type { PrismaClient } from "../db/prisma.js";
import { Prisma, type AccountStatus, type UserRole } from "../generated/prisma/client.js";
import { HttpError } from "../utils/httpError.js";

/**
 * Admin–engineer chat (Phase 5).
 *
 * - One conversation per (admin, engineer) pair (unique in the database). There is no shared inbox.
 * - Only the two members can read or write a conversation; anyone else gets 404 (no existence leak).
 * - New conversations and new messages need the other person to be ACTIVE with the opposite role.
 *   History with a deactivated user stays readable.
 * - A message is stored before anyone is told about it. A retry with the same clientId returns the
 *   stored message instead of saving a duplicate.
 */

/** The chat-relevant fields of the caller (from the authenticated session). */
export interface ChatUser {
  id: string;
  role: UserRole;
}

export interface ChatContact {
  id: string;
  fullName: string;
  role: UserRole;
  status: AccountStatus;
}

export interface ChatMessageView {
  id: string;
  conversationId: string;
  senderId: string;
  clientId: string;
  body: string;
  createdAt: Date;
}

export interface ConversationView {
  id: string;
  /** The other member (an engineer for admins, an admin for engineers). */
  contact: ChatContact;
  lastMessageAt: Date | null;
  lastMessage: ChatMessageView | null;
  createdAt: Date;
}

export interface MessagePage {
  /** Oldest first. */
  messages: ChatMessageView[];
  /** True when more messages exist in the requested direction. */
  hasMore: boolean;
}

export interface HistoryQuery {
  /** Messages strictly newer than this message (catch-up after a reconnect). */
  after?: string | undefined;
  /** Messages strictly older than this message (load earlier history). */
  before?: string | undefined;
  limit?: number | undefined;
}

export interface SendMessageInput {
  conversationId: string;
  clientId: string;
  body: string;
}

export interface SentMessage {
  message: ChatMessageView;
  /** Who should receive the push. */
  recipientId: string;
  /** True when this clientId had already been stored (a retry): nothing new was saved. */
  duplicate: boolean;
}

export interface ChatService {
  /** People the user may start a conversation with: active engineers (admin) or active admins (engineer). */
  contacts(user: ChatUser): Promise<ChatContact[]>;
  conversations(user: ChatUser): Promise<ConversationView[]>;
  /** Returns the conversation with this contact, creating it if needed (idempotent). */
  openConversation(user: ChatUser, contactId: string): Promise<ConversationView>;
  messages(user: ChatUser, conversationId: string, query: HistoryQuery): Promise<MessagePage>;
  send(user: ChatUser, input: SendMessageInput): Promise<SentMessage>;
}

const contactSelect = { id: true, fullName: true, role: true, status: true } satisfies Prisma.UserSelect;

const messageSelect = {
  id: true,
  conversationId: true,
  senderId: true,
  clientId: true,
  body: true,
  createdAt: true,
} satisfies Prisma.ChatMessageSelect;

const conversationSelect = {
  id: true,
  adminId: true,
  engineerId: true,
  lastMessageAt: true,
  createdAt: true,
  admin: { select: contactSelect },
  engineer: { select: contactSelect },
  messages: { select: messageSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 },
} satisfies Prisma.ConversationSelect;

type ConversationRow = Prisma.ConversationGetPayload<{ select: typeof conversationSelect }>;

/** The role a user may chat with. Citizens never reach the service (router + gateway refuse them). */
function counterpartRole(role: UserRole): UserRole {
  if (role === "ADMIN") return "ENGINEER";
  if (role === "ENGINEER") return "ADMIN";
  throw new HttpError(403, "FORBIDDEN", "You do not have permission to do this.");
}

function toView(row: ConversationRow, user: ChatUser): ConversationView {
  return {
    id: row.id,
    contact: user.role === "ADMIN" ? row.engineer : row.admin,
    lastMessageAt: row.lastMessageAt,
    lastMessage: row.messages[0] ?? null,
    createdAt: row.createdAt,
  };
}

const conversationNotFound = (): HttpError =>
  new HttpError(404, "CONVERSATION_NOT_FOUND", "This conversation does not exist or you are not part of it.");

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export function createChatService(deps: { prisma: PrismaClient }): ChatService {
  const { prisma } = deps;

  /** Membership filter: the conversation must include the user on their own side. */
  const memberWhere = (user: ChatUser, conversationId: string): Prisma.ConversationWhereInput => {
    counterpartRole(user.role);
    return user.role === "ADMIN" ? { id: conversationId, adminId: user.id } : { id: conversationId, engineerId: user.id };
  };

  /** A history cursor must be a message of the same conversation. */
  const loadCursor = async (conversationId: string, messageId: string, field: "after" | "before") => {
    const cursor = await prisma.chatMessage.findFirst({ where: { id: messageId, conversationId }, select: { id: true, createdAt: true } });
    if (cursor === null) {
      throw new HttpError(400, "VALIDATION_ERROR", "Some fields are invalid.", {
        details: { fields: { [field]: ["Unknown message in this conversation."] }, formErrors: [] },
      });
    }
    return cursor;
  };

  return {
    contacts: async (user) =>
      prisma.user.findMany({
        where: { role: counterpartRole(user.role), status: "ACTIVE" },
        select: contactSelect,
        orderBy: [{ fullName: "asc" }, { id: "asc" }],
      }),

    conversations: async (user) => {
      counterpartRole(user.role);
      const rows = await prisma.conversation.findMany({
        where: user.role === "ADMIN" ? { adminId: user.id } : { engineerId: user.id },
        select: conversationSelect,
        orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }, { id: "asc" }],
      });
      return rows.map((row) => toView(row, user));
    },

    openConversation: async (user, contactId) => {
      const contact = await prisma.user.findFirst({
        where: { id: contactId, role: counterpartRole(user.role), status: "ACTIVE" },
        select: { id: true },
      });
      if (contact === null) {
        throw new HttpError(404, "CHAT_CONTACT_NOT_FOUND", "You can only start a conversation with an active " +
          (user.role === "ADMIN" ? "engineer." : "administrator."));
      }
      const pair = user.role === "ADMIN" ? { adminId: user.id, engineerId: contactId } : { adminId: contactId, engineerId: user.id };
      const find = () => prisma.conversation.findUnique({ where: { adminId_engineerId: pair }, select: conversationSelect });
      const existing = await find();
      if (existing !== null) {
        return toView(existing, user);
      }
      try {
        // Create with a plain select, then read the view: a create that also loads relations runs in an
        // implicit transaction where Prisma 7 loads them in parallel on one pg connection (deprecated
        // in pg 8, an error in pg 9; see CLAUDE.md §7.1).
        await prisma.conversation.create({ data: pair, select: { id: true } });
        const created = await find();
        if (created !== null) return toView(created, user);
        throw new Error("Conversation was created but could not be read back");
      } catch (error) {
        // Both members opened the conversation at the same moment: the unique pair keeps one row.
        if (isUniqueViolation(error)) {
          const row = await find();
          if (row !== null) return toView(row, user);
        }
        throw error;
      }
    },

    messages: async (user, conversationId, query) => {
      const conversation = await prisma.conversation.findFirst({ where: memberWhere(user, conversationId), select: { id: true } });
      if (conversation === null) {
        throw conversationNotFound();
      }
      const limit = query.limit ?? CHAT_HISTORY_DEFAULT_LIMIT;

      if (query.after !== undefined) {
        const cursor = await loadCursor(conversationId, query.after, "after");
        const rows = await prisma.chatMessage.findMany({
          where: {
            conversationId,
            OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }],
          },
          select: messageSelect,
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: limit + 1,
        });
        return { messages: rows.slice(0, limit), hasMore: rows.length > limit };
      }

      const where: Prisma.ChatMessageWhereInput = { conversationId };
      if (query.before !== undefined) {
        const cursor = await loadCursor(conversationId, query.before, "before");
        where.OR = [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }];
      }
      // Newest `limit` messages (older than the cursor, if given), returned oldest first.
      const rows = await prisma.chatMessage.findMany({
        where,
        select: messageSelect,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
      });
      return { messages: rows.slice(0, limit).reverse(), hasMore: rows.length > limit };
    },

    send: async (user, input) => {
      const conversation = await prisma.conversation.findFirst({
        where: memberWhere(user, input.conversationId),
        select: { id: true, adminId: true, engineerId: true, admin: { select: { status: true } }, engineer: { select: { status: true } } },
      });
      if (conversation === null) {
        throw conversationNotFound();
      }
      const recipientId = user.role === "ADMIN" ? conversation.engineerId : conversation.adminId;

      const findRetry = async (): Promise<SentMessage | null> => {
        const stored = await prisma.chatMessage.findUnique({
          where: { senderId_clientId: { senderId: user.id, clientId: input.clientId } },
          select: messageSelect,
        });
        if (stored === null) return null;
        // A retry must be the same message: same conversation and same (trimmed) text.
        if (stored.conversationId !== input.conversationId || stored.body !== input.body) {
          throw new HttpError(409, "CHAT_CLIENT_ID_CONFLICT", "This message id was already used for another message.");
        }
        return { message: stored, recipientId, duplicate: true };
      };

      // A retry of a message that was already stored is acknowledged even if the recipient was
      // deactivated in between: the message exists, so the sender must learn that it was saved.
      const retry = await findRetry();
      if (retry !== null) {
        return retry;
      }
      const recipientStatus = user.role === "ADMIN" ? conversation.engineer.status : conversation.admin.status;
      if (recipientStatus !== "ACTIVE") {
        throw new HttpError(409, "CHAT_RECIPIENT_INACTIVE", "This account is no longer active, so it cannot receive messages.");
      }

      try {
        const message = await prisma.$transaction(async (tx) => {
          const created = await tx.chatMessage.create({
            data: { conversationId: conversation.id, senderId: user.id, clientId: input.clientId, body: input.body },
            select: messageSelect,
          });
          // Never moves backwards when two messages are stored at nearly the same time.
          await tx.conversation.updateMany({
            where: { id: conversation.id, OR: [{ lastMessageAt: null }, { lastMessageAt: { lt: created.createdAt } }] },
            data: { lastMessageAt: created.createdAt },
          });
          return created;
        });
        return { message, recipientId, duplicate: false };
      } catch (error) {
        // The same clientId was sent twice at the same moment (two tabs, fast retry): one row wins.
        if (isUniqueViolation(error)) {
          const stored = await findRetry();
          if (stored !== null) return stored;
        }
        throw error;
      }
    },
  };
}

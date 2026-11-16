import { logger } from "../utils/logger.js";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { z } from "zod";
import { ACCESS_TOKEN_COOKIE } from "../config/auth.js";
import {
  CHAT_CLOSE_CODES,
  CHAT_SEND_RATE_LIMIT,
  CHAT_WS_HEARTBEAT_MS,
  CHAT_WS_MAX_PAYLOAD_BYTES,
  CHAT_WS_PATH,
} from "../config/chat.js";
import type { ChatMessageView, ChatService, ChatUser } from "../services/chat.service.js";
import type { TokenService } from "../services/token.service.js";
import type { PublicUser, UserService } from "../services/user.service.js";
import { HttpError } from "../utils/httpError.js";
import { chatSendFrameSchema } from "../validation/schemas.js";

/**
 * WebSocket endpoint for admin–engineer chat (Phase 5), attached to the main backend's HTTP server.
 *
 * Handshake (all checked BEFORE the upgrade completes; failures get a plain HTTP error):
 *   1. path is CHAT_WS_PATH;
 *   2. Origin is in the CORS allow-list (stops other websites from using the user's cookie —
 *      cross-site WebSocket hijacking; browsers always send Origin on WebSocket handshakes);
 *   3. the access_token cookie is a valid JWT, the account is ACTIVE, the role is ADMIN or ENGINEER,
 *      and the temporary password has been changed (the same rules as the REST routes).
 *
 * Messages (client → server): {"type":"send","clientId":uuid,"conversationId":uuid,"body":string}.
 * Every send re-checks the account in the database, is validated with zod, rate-limited per user,
 * and stored BEFORE the sender gets {"type":"ack"} and the recipient gets {"type":"message"}.
 * Errors are answered with {"type":"error","clientId"?,"code","message"}.
 *
 * The socket is closed with 4001 when the access token expires (the client refreshes over REST and
 * reconnects, then fetches missed messages over REST) and with 4003 when the account may no longer
 * chat. Connections are tracked in memory: one server process (fine for the FYP; several processes
 * would need a shared pub/sub, which is out of scope).
 */

export interface ChatGatewayDependencies {
  tokens: TokenService;
  users: UserService;
  chat: ChatService;
  allowedOrigins: readonly string[];
  /** Set false in tests that need deterministic timing; defaults to true. */
  heartbeat?: boolean;
  /** Same clock as the token service (tests move it forward to simulate expiry). */
  clock?: () => Date;
}

export interface ChatGateway {
  /** Number of open sockets of a user (tests, diagnostics). */
  connectionCount(userId: string): number;
  /** Terminates every connection (graceful shutdown). */
  close(): void;
}

type ServerFrame =
  | { type: "ack"; clientId: string; message: ChatMessageView }
  | { type: "message"; message: ChatMessageView }
  | { type: "error"; clientId?: string; code: string; message: string };

interface Connection {
  socket: WebSocket;
  user: ChatUser;
  alive: boolean;
  /** When the access token used for the handshake expires (ms since epoch). */
  expiresAtMs: number;
  expiryTimer: NodeJS.Timeout;
}

const CHAT_ROLES = new Set(["ADMIN", "ENGINEER"]);

/** Parses a Cookie header (name=value; name2=value2). Values are URL-decoded like cookie-parser does. */
export function parseCookieHeader(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (header === undefined) return cookies;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name === "") continue;
    let value = part.slice(separator + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      value = decodeURIComponent(value);
    } catch {
      // Keep the raw value; a malformed token simply fails verification.
    }
    if (!cookies.has(name)) cookies.set(name, value);
  }
  return cookies;
}

function rejectHandshake(socket: Duplex, status: number, code: string, message: string): void {
  const reason = { 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 503: "Service Unavailable" }[status] ?? "Error";
  const body = JSON.stringify({ success: false, error: { code, message } });
  socket.end(
    `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Type: application/json; charset=utf-8\r\n` +
      `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
}

/** May this account use chat right now? (Same rules as authenticate + requireRole + requirePasswordChanged.) */
function chatDenial(user: PublicUser | null): { status: number; code: string; message: string } | null {
  if (user === null) return { status: 401, code: "UNAUTHENTICATED", message: "Please log in to continue." };
  if (!CHAT_ROLES.has(user.role)) return { status: 403, code: "FORBIDDEN", message: "You do not have permission to do this." };
  if (user.mustChangePassword) {
    return { status: 403, code: "PASSWORD_CHANGE_REQUIRED", message: "Change your temporary password to continue." };
  }
  return null;
}

/** Sliding-window limit per user, shared by all of the user's sockets. */
function createSendLimiter(now: () => number = Date.now) {
  const sent = new Map<string, number[]>();
  return (userId: string): boolean => {
    const cutoff = now() - CHAT_SEND_RATE_LIMIT.windowMs;
    const recent = (sent.get(userId) ?? []).filter((time) => time > cutoff);
    if (recent.length >= CHAT_SEND_RATE_LIMIT.limit) {
      sent.set(userId, recent);
      return false;
    }
    recent.push(now());
    sent.set(userId, recent);
    return true;
  };
}

export function attachChatGateway(server: Server, deps: ChatGatewayDependencies): ChatGateway {
  const allowedOrigins = new Set(deps.allowedOrigins);
  const wss = new WebSocketServer({ noServer: true, maxPayload: CHAT_WS_MAX_PAYLOAD_BYTES, clientTracking: false });
  const byUser = new Map<string, Set<Connection>>();
  const now = (): number => (deps.clock ?? (() => new Date()))().getTime();
  const allowSend = createSendLimiter(now);

  const send = (socket: WebSocket, frame: ServerFrame): void => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(frame));
    }
  };

  const pushToUser = (userId: string, frame: ServerFrame, except?: WebSocket): void => {
    for (const connection of byUser.get(userId) ?? []) {
      if (connection.socket !== except) send(connection.socket, frame);
    }
  };

  const closeUser = (userId: string, code: number, reason: string): void => {
    for (const connection of byUser.get(userId) ?? []) {
      connection.socket.close(code, reason);
    }
  };

  /** Authenticates the handshake. Returns the user and the token's expiry, or rejects the socket. */
  const authenticate = async (req: IncomingMessage, socket: Duplex): Promise<{ user: PublicUser; expiresAtMs: number } | null> => {
    const origin = req.headers.origin;
    if (origin === undefined || !allowedOrigins.has(origin)) {
      rejectHandshake(socket, 403, "CORS_ORIGIN_NOT_ALLOWED", "This origin is not allowed to access the API.");
      return null;
    }
    const token = parseCookieHeader(req.headers.cookie).get(ACCESS_TOKEN_COOKIE);
    if (token === undefined || token === "") {
      rejectHandshake(socket, 401, "UNAUTHENTICATED", "Please log in to continue.");
      return null;
    }
    const result = await deps.tokens.verifyAccessToken(token);
    if (!result.ok) {
      const expired = result.reason === "expired";
      rejectHandshake(socket, 401, expired ? "TOKEN_EXPIRED" : "UNAUTHENTICATED", expired ? "Your session has expired." : "Please log in to continue.");
      return null;
    }
    const user = await deps.users.findActiveById(result.claims.userId);
    const denial = chatDenial(user);
    if (denial !== null || user === null) {
      const d = denial ?? { status: 401, code: "UNAUTHENTICATED", message: "Please log in to continue." };
      rejectHandshake(socket, d.status, d.code, d.message);
      return null;
    }
    // Expiry from the signature-verified claims (verifyAccessToken uses jose jwtVerify).
    return { user, expiresAtMs: result.claims.expiresAt.getTime() };
  };

  const onMessage = async (connection: Connection, data: RawData, isBinary: boolean): Promise<void> => {
    const { socket } = connection;
    let parsed: unknown;
    try {
      parsed = isBinary ? undefined : JSON.parse(data.toString());
    } catch {
      parsed = undefined;
    }
    const clientIdGuess =
      typeof parsed === "object" && parsed !== null && typeof (parsed as Record<string, unknown>)["clientId"] === "string"
        ? z.uuid().safeParse((parsed as Record<string, unknown>)["clientId"]).data
        : undefined;
    const fail = (code: string, message: string): void =>
      send(socket, clientIdGuess === undefined ? { type: "error", code, message } : { type: "error", clientId: clientIdGuess, code, message });

    // The session behind this socket has expired: the client must refresh and reconnect first.
    if (now() >= connection.expiresAtMs) {
      fail("TOKEN_EXPIRED", "Your session has expired.");
      socket.close(CHAT_CLOSE_CODES.sessionExpired, "Session expired.");
      return;
    }

    const frame = chatSendFrameSchema.safeParse(parsed);
    if (!frame.success) {
      const issue = frame.error.issues[0];
      fail("VALIDATION_ERROR", issue?.message && issue.path.length > 0 ? issue.message : "Invalid message.");
      return;
    }

    // The account is re-checked on every message, so deactivation takes effect immediately.
    const user = await deps.users.findActiveById(connection.user.id);
    const denial = chatDenial(user);
    if (denial !== null || user === null || user.role !== connection.user.role) {
      fail(denial?.code ?? "FORBIDDEN", denial?.message ?? "You do not have permission to do this.");
      closeUser(connection.user.id, CHAT_CLOSE_CODES.forbidden, "Chat is no longer available for this account.");
      return;
    }
    if (!allowSend(user.id)) {
      fail("TOO_MANY_REQUESTS", "You are sending messages too quickly. Please wait a moment.");
      return;
    }

    const { clientId, conversationId, body } = frame.data;
    try {
      const result = await deps.chat.send(connection.user, { clientId, conversationId, body });
      // Stored (or found as an earlier copy): only now is the sender told it was delivered to the server.
      send(socket, { type: "ack", clientId, message: result.message });
      if (!result.duplicate) {
        pushToUser(result.recipientId, { type: "message", message: result.message });
        // The sender's other tabs show the message too.
        pushToUser(connection.user.id, { type: "message", message: result.message }, socket);
      }
    } catch (error) {
      if (error instanceof HttpError) {
        fail(error.code, error.message);
      } else {
        logger.error("chat_message_store_failed", { userId: connection.user.id, error });
        fail("INTERNAL_ERROR", "Something went wrong. Please try again.");
      }
    }
  };

  const register = (socket: WebSocket, user: PublicUser, expiresAtMs: number): void => {
    const connection: Connection = {
      socket,
      user: { id: user.id, role: user.role },
      alive: true,
      expiresAtMs,
      expiryTimer: setTimeout(
        () => socket.close(CHAT_CLOSE_CODES.sessionExpired, "Session expired."),
        Math.max(0, expiresAtMs - now()),
      ),
    };
    connection.expiryTimer.unref();
    let set = byUser.get(user.id);
    if (set === undefined) {
      set = new Set();
      byUser.set(user.id, set);
    }
    set.add(connection);

    socket.on("pong", () => {
      connection.alive = true;
    });
    socket.on("message", (data, isBinary) => {
      onMessage(connection, data, isBinary).catch((error: unknown) => {
        logger.error("chat_message_handling_failed", { error });
      });
    });
    socket.on("error", () => {
      // Protocol errors (e.g. a frame above maxPayload) close the socket; nothing else to do.
    });
    socket.on("close", () => {
      clearTimeout(connection.expiryTimer);
      const current = byUser.get(user.id);
      current?.delete(connection);
      if (current?.size === 0) byUser.delete(user.id);
    });
  };

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path !== CHAT_WS_PATH) {
      rejectHandshake(socket, 404, "NOT_FOUND", "The requested resource was not found.");
      return;
    }
    socket.on("error", () => socket.destroy());
    authenticate(req, socket)
      .then((auth) => {
        if (auth === null || socket.destroyed) return;
        wss.handleUpgrade(req, socket, head, (ws) => register(ws, auth.user, auth.expiresAtMs));
      })
      .catch((error: unknown) => {
        logger.error("chat_handshake_failed", { error });
        rejectHandshake(socket, 503, "SERVICE_UNAVAILABLE", "Chat is temporarily unavailable.");
      });
  };
  server.on("upgrade", onUpgrade);

  // Detects dead connections (no close frame ever arrives, e.g. the network dropped).
  const heartbeat =
    deps.heartbeat === false
      ? undefined
      : setInterval(() => {
          for (const set of byUser.values()) {
            for (const connection of set) {
              if (!connection.alive) {
                connection.socket.terminate();
                continue;
              }
              connection.alive = false;
              connection.socket.ping();
            }
          }
        }, CHAT_WS_HEARTBEAT_MS);
  heartbeat?.unref();

  return {
    connectionCount: (userId) => byUser.get(userId)?.size ?? 0,
    close: () => {
      if (heartbeat !== undefined) clearInterval(heartbeat);
      server.off("upgrade", onUpgrade);
      for (const set of byUser.values()) {
        for (const connection of set) {
          clearTimeout(connection.expiryTimer);
          connection.socket.terminate();
        }
      }
      byUser.clear();
      wss.close();
    },
  };
}

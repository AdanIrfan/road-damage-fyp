/** Phase 5 admin–engineer chat limits (agreed with the owner on 2026-11-15). */

/** Maximum message length in characters (after trimming). */
export const CHAT_MESSAGE_MAX_LENGTH = 2000;

/** Messages a user may send per window (in memory, per user, across all their connections). */
export const CHAT_SEND_RATE_LIMIT = { windowMs: 60_000, limit: 30 } as const;

/** History page size (REST). */
export const CHAT_HISTORY_DEFAULT_LIMIT = 50;
export const CHAT_HISTORY_MAX_LIMIT = 100;

/** WebSocket endpoint. It must be under /api: the access-token cookie is only sent to /api paths. */
export const CHAT_WS_PATH = "/api/v1/chat/ws";

/**
 * Largest WebSocket frame accepted. A 2000-character message is at most ~8 KB of UTF-8 plus the
 * JSON envelope; anything bigger is closed by the ws library (code 1009) without being parsed.
 */
export const CHAT_WS_MAX_PAYLOAD_BYTES = 16 * 1024;

/** Ping interval; a connection that misses a pong is terminated (dead network, sleeping laptop). */
export const CHAT_WS_HEARTBEAT_MS = 30_000;

/** Application close codes (4000–4999 are free for applications). */
export const CHAT_CLOSE_CODES = {
  /** The access token expired: the client refreshes its session over REST and reconnects. */
  sessionExpired: 4001,
  /** The account is no longer allowed to chat (deactivated, role/password state changed). */
  forbidden: 4003,
} as const;

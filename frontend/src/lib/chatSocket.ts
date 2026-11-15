import { api, ApiError, webSocketUrl } from "./api";
import type { ChatMessage } from "./chatTypes";

/**
 * The chat WebSocket client (one per chat page).
 *
 * - The browser sends the httpOnly session cookie with the handshake; no token is handled here.
 * - Each message gets a random clientId. Until the server acknowledges it (after storing it), it
 *   stays pending and is re-sent after a reconnect; the server never stores a clientId twice.
 * - Close code 4001 (session expired) or a failed handshake: check the session over REST (the API
 *   client refreshes an expired one), then reconnect with backoff. Only a real 401/403 stops the
 *   client; while the server is unreachable it keeps retrying. 4003: the account may no longer chat.
 * - After every (re)connect `onConnected` fires so the page can fetch missed messages over REST.
 */

export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "stopped";

export interface ChatSocketEvents {
  onStatus(status: ConnectionStatus, reason?: string): void;
  onConnected(): void;
  onMessage(message: ChatMessage): void;
  onAck(clientId: string, message: ChatMessage): void;
  onError(clientId: string | undefined, code: string, message: string): void;
}

const WS_PATH = "/api/v1/chat/ws";
const CLOSE_SESSION_EXPIRED = 4001;
const CLOSE_FORBIDDEN = 4003;
const MAX_BACKOFF_MS = 30_000;

interface Pending {
  clientId: string;
  conversationId: string;
  body: string;
}

export class ChatSocketClient {
  private socket: WebSocket | undefined;
  private readonly pending = new Map<string, Pending>();
  private attempts = 0;
  private timer: number | undefined;
  private stopped = false;

  constructor(private readonly events: ChatSocketEvents) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  /** Permanently closes the connection (page unmount, logout). */
  stop(): void {
    this.stopped = true;
    window.clearTimeout(this.timer);
    this.socket?.close(1000, "Leaving chat");
    this.socket = undefined;
  }

  /** Queues a message; it is sent now if connected, otherwise after the next reconnect. */
  send(conversationId: string, body: string): string {
    const clientId = crypto.randomUUID();
    const item = { clientId, conversationId, body };
    this.pending.set(clientId, item);
    this.transmit(item);
    return clientId;
  }

  /** Sends a failed message again with the SAME clientId (never stored twice). */
  retry(clientId: string, conversationId: string, body: string): void {
    const item = { clientId, conversationId, body };
    this.pending.set(clientId, item);
    this.transmit(item);
  }

  private transmit(item: Pending): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: "send", ...item }));
    }
  }

  private connect(): void {
    if (this.stopped) return;
    this.events.onStatus(this.attempts === 0 ? "connecting" : "reconnecting");
    const socket = new WebSocket(webSocketUrl(WS_PATH));
    this.socket = socket;
    let opened = false;

    socket.onopen = () => {
      opened = true;
      this.attempts = 0;
      this.events.onStatus("open");
      this.events.onConnected();
      // Anything not acknowledged before the connection dropped is sent again (idempotent).
      for (const item of this.pending.values()) this.transmit(item);
    };

    socket.onmessage = (event: MessageEvent) => {
      let frame: { type?: string; clientId?: string; message?: unknown; code?: string };
      try {
        frame = JSON.parse(String(event.data)) as typeof frame;
      } catch {
        return;
      }
      if (frame.type === "ack" && typeof frame.clientId === "string") {
        this.pending.delete(frame.clientId);
        this.events.onAck(frame.clientId, frame.message as ChatMessage);
      } else if (frame.type === "message") {
        this.events.onMessage(frame.message as ChatMessage);
      } else if (frame.type === "error") {
        // A rejected message is not retried automatically; the user can retry it.
        if (typeof frame.clientId === "string") this.pending.delete(frame.clientId);
        this.events.onError(frame.clientId, frame.code ?? "ERROR", String((frame as { message?: unknown }).message ?? "Message not sent."));
      }
    };

    socket.onclose = (event: CloseEvent) => {
      if (this.socket !== socket || this.stopped) return;
      this.socket = undefined;
      if (event.code === CLOSE_FORBIDDEN) {
        this.stopped = true;
        this.events.onStatus("stopped", "Chat is no longer available for this account.");
        return;
      }
      void this.reconnect(event.code === CLOSE_SESSION_EXPIRED || !opened);
    };
  }

  private async reconnect(checkSessionFirst: boolean): Promise<void> {
    this.attempts += 1;
    this.events.onStatus("reconnecting");
    const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** Math.min(this.attempts - 1, 6));
    // The handshake failed or the session expired. Ask the API who we are: the API client renews an
    // expired session cookie on the way. A network error or 5xx only means the server is not
    // reachable yet (restart, outage), so keep retrying; only 401/403 ends the chat session.
    if (checkSessionFirst) {
      const session = await this.checkSession();
      if (this.stopped) return;
      if (session === "ended") {
        this.stopped = true;
        this.events.onStatus("stopped", "Your session has ended. Please log in again.");
        return;
      }
      if (session === "unreachable") {
        this.timer = window.setTimeout(() => void this.reconnect(true), delay);
        return;
      }
    }
    this.timer = window.setTimeout(() => this.connect(), delay);
  }

  private async checkSession(): Promise<"ok" | "ended" | "unreachable"> {
    try {
      await api.get("/api/v1/auth/me");
      return "ok";
    } catch (error) {
      return error instanceof ApiError && (error.status === 401 || error.status === 403) ? "ended" : "unreachable";
    }
  }
}

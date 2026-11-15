import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { CHAT_WS_PATH } from "../../src/config/chat.js";
import { ALLOWED_ORIGIN, type TestClient } from "./authTestApp.js";

export type Frame = Record<string, unknown> & { type: string };

export type HandshakeResult =
  | { ok: true; socket: ChatSocket }
  | { ok: false; status: number; code: string | undefined };

/** A test WebSocket client that records every frame it receives. */
export class ChatSocket {
  readonly frames: Frame[] = [];
  closeCode: number | undefined;
  private waiters: (() => void)[] = [];

  constructor(readonly ws: WebSocket) {
    ws.on("message", (data) => {
      this.frames.push(JSON.parse(data.toString()) as Frame);
      this.wake();
    });
    ws.on("close", (code) => {
      this.closeCode = code;
      this.wake();
    });
  }

  private wake(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const wake of waiters) wake();
  }

  /** Waits until a frame received at index >= fromIndex matches (default timeout 3 s). */
  async waitFor(predicate: (frame: Frame) => boolean, timeoutMs = 3000, fromIndex = 0): Promise<Frame> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.frames.slice(fromIndex).find(predicate);
      if (found !== undefined) return found;
      if (Date.now() > deadline) throw new Error(`No matching frame; received: ${JSON.stringify(this.frames)}`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 50);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  async waitForClose(timeoutMs = 3000): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    while (this.closeCode === undefined) {
      if (Date.now() > deadline) throw new Error("Socket did not close");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return this.closeCode;
  }

  sendRaw(data: string): void {
    this.ws.send(data);
  }

  /** Sends a chat message and returns its clientId. */
  send(conversationId: string, body: string, clientId: string = randomUUID()): string {
    this.ws.send(JSON.stringify({ type: "send", clientId, conversationId, body }));
    return clientId;
  }

  /** Sends and waits for the ack or error answering this send (frames received after it). */
  async sendAndWait(conversationId: string, body: string, clientId: string = randomUUID()): Promise<Frame> {
    const start = this.frames.length;
    const id = this.send(conversationId, body, clientId);
    return this.waitFor((f) => (f.type === "ack" || f.type === "error") && f["clientId"] === id, 3000, start);
  }

  /** Frames of a type (e.g. pushed "message" frames). */
  ofType(type: string): Frame[] {
    return this.frames.filter((f) => f.type === type);
  }

  close(): void {
    this.ws.close();
  }
}

/** Opens a chat WebSocket with the client's cookies (like a browser on the allowed origin). */
export function connectChat(
  baseUrl: string,
  client: TestClient | undefined,
  options: { origin?: string | null; path?: string } = {},
): Promise<HandshakeResult> {
  const headers: Record<string, string> = {};
  const origin = options.origin === undefined ? ALLOWED_ORIGIN : options.origin;
  if (origin !== null) headers["origin"] = origin;
  if (client !== undefined && client.cookies.size > 0) {
    headers["cookie"] = [...client.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }
  const url = `${baseUrl.replace(/^http/, "ws")}${options.path ?? CHAT_WS_PATH}`;
  return new Promise((resolve, reject) => {
    // `origin` is passed as a header so the test can also omit it entirely.
    const ws = new WebSocket(url, { headers });
    const socket = new ChatSocket(ws);
    ws.once("open", () => resolve({ ok: true, socket }));
    ws.once("unexpected-response", (_req, res) => {
      let text = "";
      res.on("data", (chunk: Buffer) => (text += chunk.toString()));
      res.on("end", () => {
        let code: string | undefined;
        try {
          code = (JSON.parse(text) as { error?: { code?: string } }).error?.code;
        } catch {
          code = undefined;
        }
        resolve({ ok: false, status: res.statusCode ?? 0, code });
      });
    });
    ws.once("error", (error) => reject(error));
  });
}

export async function connectOk(baseUrl: string, client: TestClient): Promise<ChatSocket> {
  const result = await connectChat(baseUrl, client);
  if (!result.ok) throw new Error(`chat handshake failed: ${result.status} ${result.code}`);
  return result.socket;
}

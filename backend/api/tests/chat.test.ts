import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { CHAT_CLOSE_CODES, CHAT_MESSAGE_MAX_LENGTH, CHAT_SEND_RATE_LIMIT } from "../src/config/chat.js";
import { parseCookieHeader } from "../src/realtime/chatGateway.js";
import { createVerifiedCitizen, numbers, startAuthTestApp, type AuthTestContext, type TestClient } from "./helpers/authTestApp.js";
import { connectChat, connectOk, type ChatSocket, type Frame } from "./helpers/chatSocket.js";
import { setupTestDatabase, skipWithoutDatabase, type TestDatabase } from "./helpers/testDb.js";
import { createActiveEngineer, loginAs, setupAdmin, type Json } from "./helpers/workflowFixtures.js";

const ADMIN2 = "+12025550111";

describe("parseCookieHeader", () => {
  it("reads name=value pairs, URL-decodes values and keeps the first duplicate", () => {
    const cookies = parseCookieHeader("a=1; access_token=x%2Ey; a=2; broken; =v");
    assert.equal(cookies.get("a"), "1");
    assert.equal(cookies.get("access_token"), "x.y");
    assert.equal(cookies.size, 2);
    assert.equal(parseCookieHeader(undefined).size, 0);
  });
});

describe("admin–engineer chat", { skip: skipWithoutDatabase }, () => {
  let db: TestDatabase;
  let ctx: AuthTestContext;
  let admin: TestClient;
  let engineer: TestClient;
  let engineerId: string;
  let adminId: string;
  const sockets: ChatSocket[] = [];

  const base = () => ctx.server.baseUrl;
  const connect = async (client: TestClient): Promise<ChatSocket> => {
    const socket = await connectOk(base(), client);
    sockets.push(socket);
    return socket;
  };
  const conversationOf = (res: { body: { data?: Record<string, unknown> } }) => res.body.data?.["conversation"] as Json;
  const open = async (client: TestClient, userId: string): Promise<string> => {
    const res = await client.post("/api/v1/chat/conversations", { userId });
    assert.equal(res.status, 200, res.text);
    return String(conversationOf(res)["id"]);
  };
  const history = (client: TestClient, conversationId: string, query = "") =>
    client.get(`/api/v1/chat/conversations/${conversationId}/messages${query}`);
  const messagesOf = (res: { body: { data?: Record<string, unknown> } }) => (res.body.data?.["messages"] as Json[]) ?? [];
  const messageOf = (frame: Frame) => frame["message"] as Json;

  before(async () => {
    db = setupTestDatabase();
    ctx = await startAuthTestApp(db.prisma);
  });
  after(async () => {
    await ctx.close();
    await db.close();
  });
  beforeEach(async () => {
    await db.reset();
    admin = await setupAdmin(db, ctx);
    adminId = String(((await admin.get("/api/v1/auth/me")).body.data?.["user"] as Json)["id"]);
    ({ client: engineer, id: engineerId } = await createActiveEngineer(ctx, admin));
  });
  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.close();
  });

  describe("WebSocket handshake", () => {
    it("rejects connections without a session", async () => {
      const result = await connectChat(base(), undefined);
      assert.deepEqual(result.ok ? "open" : [result.status, result.code], [401, "UNAUTHENTICATED"]);
    });

    it("rejects an invalid token", async () => {
      const forged = ctx.client();
      forged.cookies.set("access_token", "not-a-jwt");
      const result = await connectChat(base(), forged);
      assert.deepEqual(result.ok ? "open" : [result.status, result.code], [401, "UNAUTHENTICATED"]);
    });

    it("rejects foreign or missing Origin headers (cross-site WebSocket hijacking)", async () => {
      const foreign = await connectChat(base(), admin, { origin: "https://evil.example" });
      assert.deepEqual(foreign.ok ? "open" : [foreign.status, foreign.code], [403, "CORS_ORIGIN_NOT_ALLOWED"]);
      const missing = await connectChat(base(), admin, { origin: null });
      assert.deepEqual(missing.ok ? "open" : [missing.status, missing.code], [403, "CORS_ORIGIN_NOT_ALLOWED"]);
    });

    it("rejects citizens", async () => {
      const citizen = await createVerifiedCitizen(ctx);
      const result = await connectChat(base(), citizen);
      assert.deepEqual(result.ok ? "open" : [result.status, result.code], [403, "FORBIDDEN"]);
    });

    it("rejects engineers who still have a temporary password", async () => {
      const created = await admin.post("/api/v1/admin/engineers", {
        fullName: "Temp Eng",
        mobileNumber: numbers.engineer2,
        temporaryPassword: "temporary-pass-123",
      });
      assert.equal(created.status, 201);
      const temp = await loginAs(ctx, numbers.engineer2, "temporary-pass-123");
      const result = await connectChat(base(), temp);
      assert.deepEqual(result.ok ? "open" : [result.status, result.code], [403, "PASSWORD_CHANGE_REQUIRED"]);
    });

    it("rejects an expired access token and unknown paths", async () => {
      ctx.clock.advanceSeconds(16 * 60);
      const expired = await connectChat(base(), admin);
      assert.deepEqual(expired.ok ? "open" : [expired.status, expired.code], [401, "TOKEN_EXPIRED"]);
      ctx.clock.advanceSeconds(-16 * 60);
      const wrongPath = await connectChat(base(), admin, { path: "/api/v1/chat/other" });
      assert.deepEqual(wrongPath.ok ? "open" : [wrongPath.status, wrongPath.code], [404, "NOT_FOUND"]);
    });

    it("accepts admins and active engineers", async () => {
      await connect(admin);
      await connect(engineer);
      assert.equal(ctx.chatGateway.connectionCount(adminId), 1);
      assert.equal(ctx.chatGateway.connectionCount(engineerId), 1);
    });
  });

  describe("REST access", () => {
    it("is limited to logged-in admins and engineers", async () => {
      assert.equal((await ctx.client().get("/api/v1/chat/contacts")).status, 401);
      const citizen = await createVerifiedCitizen(ctx);
      for (const path of ["/api/v1/chat/contacts", "/api/v1/chat/conversations"]) {
        const res = await citizen.get(path);
        assert.deepEqual([res.status, res.body.error?.code], [403, "FORBIDDEN"], path);
      }
      const post = await citizen.post("/api/v1/chat/conversations", { userId: adminId });
      assert.equal(post.status, 403);
    });

    it("lists only active counterparts as contacts, with no private fields", async () => {
      const second = await createActiveEngineer(ctx, admin, numbers.engineer2, "Eng Two");
      assert.equal((await admin.patch(`/api/v1/admin/engineers/${second.id}/status`, { status: "DEACTIVATED" })).status, 200);
      const adminContacts = (await admin.get("/api/v1/chat/contacts")).body.data?.["contacts"] as Json[];
      assert.deepEqual(adminContacts.map((c) => c["id"]), [engineerId]);
      assert.deepEqual(Object.keys(adminContacts[0] ?? {}).sort(), ["fullName", "id", "role", "status"]);
      const engineerContacts = (await engineer.get("/api/v1/chat/contacts")).body.data?.["contacts"] as Json[];
      assert.deepEqual(engineerContacts.map((c) => c["id"]), [adminId]);
    });

    it("opens one conversation per admin–engineer pair, from either side, idempotently", async () => {
      const first = await open(admin, engineerId);
      assert.equal(await open(admin, engineerId), first);
      assert.equal(await open(engineer, adminId), first);
      const [a, b] = await Promise.all([open(admin, engineerId), open(engineer, adminId)]);
      assert.equal(a, first);
      assert.equal(b, first);
      assert.equal(await db.prisma.conversation.count(), 1);

      const admin2 = await setupAdmin(db, ctx, ADMIN2);
      const other = await open(admin2, engineerId);
      assert.notEqual(other, first, "a second admin gets a separate conversation with the same engineer");
    });

    it("refuses conversations with the wrong role, inactive accounts or unknown users", async () => {
      const admin2 = await setupAdmin(db, ctx, ADMIN2);
      const admin2Id = String(((await admin2.get("/api/v1/auth/me")).body.data?.["user"] as Json)["id"]);
      const citizen = await createVerifiedCitizen(ctx);
      const citizenId = String(((await citizen.get("/api/v1/auth/me")).body.data?.["user"] as Json)["id"]);
      const second = await createActiveEngineer(ctx, admin, numbers.engineer2, "Eng Two");
      assert.equal((await admin.patch(`/api/v1/admin/engineers/${second.id}/status`, { status: "DEACTIVATED" })).status, 200);

      for (const [client, userId, label] of [
        [admin, admin2Id, "admin → admin"],
        [admin, citizenId, "admin → citizen"],
        [admin, second.id, "admin → deactivated engineer"],
        [admin, randomUUID(), "admin → unknown"],
        [engineer, citizenId, "engineer → citizen"],
        [engineer, engineerId, "engineer → self"],
      ] as const) {
        const res = await client.post("/api/v1/chat/conversations", { userId });
        assert.deepEqual([res.status, res.body.error?.code], [404, "CHAT_CONTACT_NOT_FOUND"], label);
      }
      const invalid = await admin.post("/api/v1/chat/conversations", { userId: "nope" });
      assert.deepEqual([invalid.status, invalid.body.error?.code], [400, "VALIDATION_ERROR"]);
      const extra = await admin.post("/api/v1/chat/conversations", { userId: engineerId, role: "ADMIN" });
      assert.equal(extra.status, 400);
      const noCsrf = await admin.request("POST", "/api/v1/chat/conversations", { userId: engineerId }, { csrf: false });
      assert.deepEqual([noCsrf.status, noCsrf.body.error?.code], [403, "CSRF_TOKEN_INVALID"]);
    });
  });

  describe("messaging", () => {
    it("stores a message before acknowledging it and pushes it to the other member", async () => {
      const conversationId = await open(admin, engineerId);
      const adminSocket = await connect(admin);
      const engineerSocket = await connect(engineer);

      const ack = await adminSocket.sendAndWait(conversationId, "  Please check report #12 today.  ");
      assert.equal(ack.type, "ack");
      const stored = await db.prisma.chatMessage.findUnique({ where: { id: String(messageOf(ack)["id"]) } });
      assert.ok(stored !== null, "the acknowledged message is in the database");
      assert.equal(stored.body, "Please check report #12 today.", "trimmed");
      assert.equal(stored.senderId, adminId);

      const pushed = await engineerSocket.waitFor((f) => f.type === "message");
      assert.equal(messageOf(pushed)["id"], messageOf(ack)["id"]);

      const reply = await engineerSocket.sendAndWait(conversationId, "On my way.");
      assert.equal(reply.type, "ack");
      const received = await adminSocket.waitFor((f) => f.type === "message" && messageOf(f)["id"] === messageOf(reply)["id"]);
      assert.equal(messageOf(received)["senderId"], engineerId);

      const listed = (await admin.get("/api/v1/chat/conversations")).body.data?.["conversations"] as Json[];
      assert.equal(listed.length, 1);
      assert.equal((listed[0]?.["lastMessage"] as Json)["body"], "On my way.");
      assert.equal((listed[0]?.["contact"] as Json)["id"], engineerId);
    });

    it("shows the sender's message in the sender's other tabs, not twice in the sending tab", async () => {
      const conversationId = await open(admin, engineerId);
      const tab1 = await connect(admin);
      const tab2 = await connect(admin);
      const ack = await tab1.sendAndWait(conversationId, "hello");
      await tab2.waitFor((f) => f.type === "message" && messageOf(f)["id"] === messageOf(ack)["id"]);
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(tab1.ofType("message").length, 0);
    });

    it("keeps message text exactly as plain text (no HTML processing on the server)", async () => {
      const conversationId = await open(admin, engineerId);
      const socket = await connect(admin);
      const text = `<img src=x onerror="alert(1)"> & "quotes" — ünïcödé 🚧`;
      const ack = await socket.sendAndWait(conversationId, text);
      assert.equal(messageOf(ack)["body"], text);
      const res = await history(engineer, conversationId);
      assert.equal(messagesOf(res)[0]?.["body"], text);
    });

    it("is idempotent: a retried clientId returns the stored message and saves nothing new", async () => {
      const conversationId = await open(admin, engineerId);
      const adminSocket = await connect(admin);
      const engineerSocket = await connect(engineer);
      const clientId = randomUUID();
      const first = await adminSocket.sendAndWait(conversationId, "only once", clientId);
      const retry = await adminSocket.sendAndWait(conversationId, "only once", clientId);
      assert.equal(retry.type, "ack");
      assert.equal(messageOf(retry)["id"], messageOf(first)["id"]);
      // Simultaneous duplicates (e.g. two quick retries) also store one row.
      const racing = randomUUID();
      adminSocket.send(conversationId, "race", racing);
      adminSocket.send(conversationId, "race", racing);
      await adminSocket.waitFor((f) => f.type === "ack" && f["clientId"] === racing);
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.equal(await db.prisma.chatMessage.count(), 2);
      assert.equal(engineerSocket.ofType("message").length, 2, "the recipient gets each message once");

      // The same clientId with different text is not a retry: refused, the original row is untouched.
      const changed = await adminSocket.sendAndWait(conversationId, "different text", clientId);
      assert.deepEqual([changed.type, changed["code"]], ["error", "CHAT_CLIENT_ID_CONFLICT"]);
      const original = await db.prisma.chatMessage.findMany({ where: { clientId } });
      assert.deepEqual(original.map((m) => m.body), ["only once"]);
      // Surrounding whitespace is trimmed before comparing, so it is still the same message.
      const padded = await adminSocket.sendAndWait(conversationId, "  only once  ", clientId);
      assert.deepEqual([padded.type, messageOf(padded)["id"]], ["ack", messageOf(first)["id"]]);

      // The same clientId may not be reused for a different conversation.
      const admin2Conversation = await open(admin, (await createActiveEngineer(ctx, admin, numbers.engineer2, "Eng Two")).id);
      const conflict = await adminSocket.sendAndWait(admin2Conversation, "other", clientId);
      assert.deepEqual([conflict.type, conflict["code"]], ["error", "CHAT_CLIENT_ID_CONFLICT"]);
    });

    it("keeps conversations of different admin–engineer pairs separate", async () => {
      const admin2 = await setupAdmin(db, ctx, ADMIN2);
      const second = await createActiveEngineer(ctx, admin, numbers.engineer2, "Eng Two");
      const conversationId = await open(admin, engineerId);
      const adminSocket = await connect(admin);
      await adminSocket.sendAndWait(conversationId, "private to engineer one");

      // Another admin and another engineer cannot read it...
      for (const [client, label] of [[admin2, "other admin"], [second.client, "other engineer"]] as const) {
        const res = await history(client, conversationId);
        assert.deepEqual([res.status, res.body.error?.code], [404, "CONVERSATION_NOT_FOUND"], label);
        const listed = (await client.get("/api/v1/chat/conversations")).body.data?.["conversations"] as Json[];
        assert.equal(listed.length, 0, label);
      }
      // ...cannot write to it, and are not sent its messages.
      const admin2Socket = await connect(admin2);
      const secondSocket = await connect(second.client);
      for (const socket of [admin2Socket, secondSocket]) {
        const denied = await socket.sendAndWait(conversationId, "intrusion");
        assert.deepEqual([denied.type, denied["code"]], ["error", "CONVERSATION_NOT_FOUND"]);
      }
      await adminSocket.sendAndWait(conversationId, "second private message");
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(admin2Socket.ofType("message").length + secondSocket.ofType("message").length, 0);
      assert.equal(await db.prisma.chatMessage.count(), 2);
    });

    it("rejects invalid and oversized messages", async () => {
      const conversationId = await open(admin, engineerId);
      const socket = await connect(admin);
      const cases: [string, unknown][] = [
        ["empty", { type: "send", clientId: randomUUID(), conversationId, body: "   " }],
        ["too long", { type: "send", clientId: randomUUID(), conversationId, body: "x".repeat(CHAT_MESSAGE_MAX_LENGTH + 1) }],
        ["bad clientId", { type: "send", clientId: "1", conversationId, body: "hi" }],
        ["bad conversation", { type: "send", clientId: randomUUID(), conversationId: "nope", body: "hi" }],
        ["unknown type", { type: "typing", clientId: randomUUID(), conversationId }],
        ["extra field", { type: "send", clientId: randomUUID(), conversationId, body: "hi", senderId: engineerId }],
        ["body not string", { type: "send", clientId: randomUUID(), conversationId, body: 42 }],
      ];
      for (const [label, frame] of cases) {
        const start = socket.frames.length;
        socket.sendRaw(JSON.stringify(frame));
        const error = await socket.waitFor((f) => f.type === "error", 3000, start);
        assert.equal(error["code"], "VALIDATION_ERROR", label);
      }
      const start = socket.frames.length;
      socket.sendRaw("{not json");
      assert.equal((await socket.waitFor((f) => f.type === "error", 3000, start))["code"], "VALIDATION_ERROR");
      assert.equal(await db.prisma.chatMessage.count(), 0);

      // Exactly the maximum length is fine.
      const ok = await socket.sendAndWait(conversationId, "y".repeat(CHAT_MESSAGE_MAX_LENGTH));
      assert.equal(ok.type, "ack");

      // A frame above the size limit closes the connection without being processed.
      socket.sendRaw(JSON.stringify({ type: "send", clientId: randomUUID(), conversationId, body: "z".repeat(20_000) }));
      assert.equal(await socket.waitForClose(), 1009);
      assert.equal(await db.prisma.chatMessage.count(), 1);
    });

    it(`limits sending to ${CHAT_SEND_RATE_LIMIT.limit} messages per minute per user`, async () => {
      const conversationId = await open(admin, engineerId);
      const socket = await connect(admin);
      for (let i = 0; i < CHAT_SEND_RATE_LIMIT.limit; i++) {
        assert.equal((await socket.sendAndWait(conversationId, `m${i}`)).type, "ack");
      }
      const limited = await socket.sendAndWait(conversationId, "one too many");
      assert.deepEqual([limited.type, limited["code"]], ["error", "TOO_MANY_REQUESTS"]);
      ctx.clock.advanceSeconds(61);
      // The access token is still valid for this socket (15 min); the window has moved on.
      assert.equal((await socket.sendAndWait(conversationId, "later")).type, "ack");
    });
  });

  describe("history and reconnection", () => {
    it("returns missed messages through REST after a reconnect, in order", async () => {
      const conversationId = await open(admin, engineerId);
      const adminSocket = await connect(admin);
      const engineerSocket = await connect(engineer);
      const seen = await adminSocket.sendAndWait(conversationId, "before disconnect");
      await engineerSocket.waitFor((f) => f.type === "message");
      engineerSocket.close();
      await engineerSocket.waitForClose();

      const missed: string[] = [];
      for (const text of ["missed 1", "missed 2", "missed 3"]) {
        missed.push(String(messageOf(await adminSocket.sendAndWait(conversationId, text))["id"]));
      }

      // The engineer reconnects, then fetches everything after the last message it had.
      await connect(engineer);
      const res = await history(engineer, conversationId, `?after=${String(messageOf(seen)["id"])}`);
      assert.equal(res.status, 200);
      assert.deepEqual(messagesOf(res).map((m) => m["id"]), missed);
      assert.equal(res.body.data?.["hasMore"], false);

      // History survives a "refresh": the full conversation, oldest first.
      const full = await history(engineer, conversationId);
      assert.deepEqual(messagesOf(full).map((m) => m["body"]), ["before disconnect", "missed 1", "missed 2", "missed 3"]);
    });

    it("pages backwards with before/limit and validates the query", async () => {
      const conversationId = await open(admin, engineerId);
      const socket = await connect(admin);
      for (let i = 1; i <= 5; i++) await socket.sendAndWait(conversationId, `m${i}`);
      const latest = await history(admin, conversationId, "?limit=2");
      assert.deepEqual(messagesOf(latest).map((m) => m["body"]), ["m4", "m5"]);
      assert.equal(latest.body.data?.["hasMore"], true);
      const older = await history(admin, conversationId, `?limit=2&before=${String(messagesOf(latest)[0]?.["id"])}`);
      assert.deepEqual(messagesOf(older).map((m) => m["body"]), ["m2", "m3"]);
      const oldest = await history(admin, conversationId, `?limit=2&before=${String(messagesOf(older)[0]?.["id"])}`);
      assert.deepEqual([messagesOf(oldest).map((m) => m["body"]), oldest.body.data?.["hasMore"]], [["m1"], false]);

      for (const query of ["?limit=0", "?limit=101", "?after=x", `?after=${randomUUID()}`, `?after=${randomUUID()}&before=${randomUUID()}`, "?foo=1"]) {
        const res = await history(admin, conversationId, query);
        assert.deepEqual([res.status, res.body.error?.code], [400, "VALIDATION_ERROR"], query);
      }
      assert.equal((await history(admin, "not-a-uuid")).status, 400);
      assert.equal((await history(admin, randomUUID())).status, 404);
    });
  });

  describe("account status", () => {
    it("stops a deactivated engineer immediately, keeps history, and refuses new messages to them", async () => {
      const conversationId = await open(admin, engineerId);
      const adminSocket = await connect(admin);
      const engineerSocket = await connect(engineer);
      await adminSocket.sendAndWait(conversationId, "before deactivation");

      assert.equal((await admin.patch(`/api/v1/admin/engineers/${engineerId}/status`, { status: "DEACTIVATED" })).status, 200);

      // The open socket cannot be used any more.
      const denied = await engineerSocket.sendAndWait(conversationId, "still here?");
      assert.deepEqual([denied.type, denied["code"]], ["error", "UNAUTHENTICATED"]);
      assert.equal(await engineerSocket.waitForClose(), CHAT_CLOSE_CODES.forbidden);
      // Nor can REST or a new connection.
      assert.equal((await history(engineer, conversationId)).status, 401);
      const reconnect = await connectChat(base(), engineer);
      assert.deepEqual(reconnect.ok ? "open" : reconnect.status, 401);

      // The admin keeps the history but cannot send new messages to an inactive account.
      const refused = await adminSocket.sendAndWait(conversationId, "are you there?");
      assert.deepEqual([refused.type, refused["code"]], ["error", "CHAT_RECIPIENT_INACTIVE"]);
      assert.deepEqual(messagesOf(await history(admin, conversationId)).map((m) => m["body"]), ["before deactivation"]);
      const listed = (await admin.get("/api/v1/chat/conversations")).body.data?.["conversations"] as Json[];
      assert.equal((listed[0]?.["contact"] as Json)["status"], "DEACTIVATED");
    });

    it("closes the socket with 4001 when the session behind it has expired", async () => {
      const conversationId = await open(admin, engineerId);
      const socket = await connect(admin);
      ctx.clock.advanceSeconds(16 * 60);
      const expired = await socket.sendAndWait(conversationId, "late");
      assert.deepEqual([expired.type, expired["code"]], ["error", "TOKEN_EXPIRED"]);
      assert.equal(await socket.waitForClose(), CHAT_CLOSE_CODES.sessionExpired);
      assert.equal(await db.prisma.chatMessage.count(), 0);
    });
  });
});

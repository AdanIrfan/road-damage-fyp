import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { AiServiceError } from "../src/services/ai/aiClient.js";
import { createVerifiedCitizen, numbers, startAuthTestApp, type AuthTestContext, type TestClient } from "./helpers/authTestApp.js";
import { connectOk, type ChatSocket } from "./helpers/chatSocket.js";
import { setupTestDatabase, skipWithoutDatabase, type TestDatabase } from "./helpers/testDb.js";
import { makeJpeg } from "./helpers/testImages.js";
import { acceptedReport, createActiveEngineer, setupAdmin, submitReport, type Json } from "./helpers/workflowFixtures.js";

describe("in-app notifications", { skip: skipWithoutDatabase }, () => {
  let db: TestDatabase;
  let ctx: AuthTestContext;
  let admin: TestClient;
  let citizen: TestClient;
  const sockets: ChatSocket[] = [];

  const list = async (client: TestClient): Promise<{ items: Json[]; unread: number; total: number }> => {
    const res = await client.get("/api/v1/notifications");
    assert.equal(res.status, 200, res.text);
    return res.body.data as unknown as { items: Json[]; unread: number; total: number };
  };
  const types = async (client: TestClient): Promise<string[]> => (await list(client)).items.map((n) => String(n["type"])).sort();
  const unread = async (client: TestClient): Promise<number> => Number((await client.get("/api/v1/notifications/unread-count")).body.data?.["unread"]);
  const adminReport = (id: string) => `/api/v1/admin/reports/${id}`;
  const job = (id: string) => `/api/v1/engineer/jobs/${id}`;
  const assign = (id: string, engineerId: string) => admin.post(`${adminReport(id)}/assignment`, { engineerId });
  async function photo(client: TestClient, id: string, attempt: number) {
    const form = new FormData();
    form.append("expectedAttempt", String(attempt));
    form.append("image", new Blob([new Uint8Array(await makeJpeg(160, 120))], { type: "image/jpeg" }), "repair.jpg");
    return client.postForm(`${job(id)}/photos`, form);
  }
  const setStatus = (client: TestClient, id: string, status: string, expectedAttempt: number) =>
    client.patch(`${job(id)}/repair-status`, { status, expectedAttempt });

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
    ctx.ai.reset();
    admin = await setupAdmin(db, ctx);
    citizen = await createVerifiedCitizen(ctx);
  });
  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.close();
  });

  it("requires a session and rejects invalid queries", async () => {
    assert.equal((await ctx.client().get("/api/v1/notifications")).status, 401);
    assert.equal((await ctx.client().get("/api/v1/notifications/unread-count")).status, 401);
    assert.equal((await citizen.get("/api/v1/notifications?pageSize=500")).status, 400);
    assert.equal((await citizen.post("/api/v1/notifications/not-a-uuid/read")).status, 400);
  });

  it("report submission notifies the citizen and every active admin, once", async () => {
    const admin2 = await setupAdmin(db, ctx, "+12025550111");
    const id = await submitReport(citizen);
    const mine = await list(citizen);
    assert.deepEqual(mine.items.map((n) => [n["type"], n["reportId"], n["readAt"]]), [["REPORT_SUBMITTED", id, null]]);
    assert.equal(mine.unread, 1);
    assert.deepEqual(await types(admin), ["NEW_REPORT"]);
    assert.deepEqual(await types(admin2), ["NEW_REPORT"]);
    // Texts never contain personal data of the citizen.
    assert.ok(!JSON.stringify((await list(admin)).items).includes("Test Citizen"));
  });

  it("a failed AI analysis also notifies admins; a rejected upload notifies nobody", async () => {
    ctx.ai.failWith = new AiServiceError("unavailable", "simulated");
    await submitReport(citizen);
    assert.deepEqual(await types(admin), ["AI_ANALYSIS_FAILED", "NEW_REPORT"]);

    const form = new FormData();
    form.append("captureMethod", "GALLERY_UPLOAD");
    form.append("latitude", "31.5");
    form.append("longitude", "74.3");
    form.append("image", new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/jpeg" }), "fake.jpg");
    const refused = await citizen.postForm("/api/v1/reports", form);
    assert.ok(refused.status >= 400);
    assert.equal((await list(admin)).total, 2, "no notification for a refused report");
    assert.equal((await list(citizen)).total, 1);
  });

  it("decisions notify the citizen with the reason; review and keep-delayed do not", async () => {
    const id = await submitReport(citizen);
    await admin.post(`${adminReport(id)}/review`);
    assert.deepEqual(await types(citizen), ["REPORT_SUBMITTED"], "Start review does not notify");

    await admin.post(`${adminReport(id)}/decision`, { decision: "DELAY", reason: "Road works planned" });
    const delayed = (await list(citizen)).items.find((n) => n["type"] === "REPORT_DELAYED");
    assert.ok(String(delayed?.["body"]).includes("Road works planned"));

    await admin.post(`${adminReport(id)}/decision`, { decision: "DELAY", reason: "Still waiting" });
    assert.equal((await list(citizen)).items.filter((n) => n["type"] === "REPORT_DELAYED").length, 1, "keep-delayed does not notify");

    await admin.post(`${adminReport(id)}/decision`, { decision: "ACCEPT" });
    assert.deepEqual(await types(citizen), ["REPORT_ACCEPTED", "REPORT_DELAYED", "REPORT_SUBMITTED"]);

    const other = await submitReport(citizen);
    await admin.post(`${adminReport(other)}/review`);
    await admin.post(`${adminReport(other)}/decision`, { decision: "REJECT", reason: "Not a road" });
    const rejected = (await list(citizen)).items.find((n) => n["type"] === "REPORT_REJECTED");
    assert.equal(rejected?.["reportId"], other);
    assert.ok(String(rejected?.["body"]).includes("Not a road"));
  });

  it("a refused or repeated decision creates no notification", async () => {
    const id = await submitReport(citizen);
    // Not under review yet: the decision is refused.
    assert.equal((await admin.post(`${adminReport(id)}/decision`, { decision: "ACCEPT" })).status, 409);
    await admin.post(`${adminReport(id)}/review`);
    const results = await Promise.all([
      admin.post(`${adminReport(id)}/decision`, { decision: "ACCEPT" }),
      admin.post(`${adminReport(id)}/decision`, { decision: "ACCEPT" }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await list(citizen)).items.filter((n) => n["type"] === "REPORT_ACCEPTED").length, 1);
  });

  it("follows a job: assignment, reassignment, repair progress, rework and confirmation", async () => {
    const id = await acceptedReport(admin, citizen);
    const first = await createActiveEngineer(ctx, admin, numbers.engineer, "Eng One");
    const second = await createActiveEngineer(ctx, admin, numbers.engineer2, "Eng Two");

    await assign(id, first.id);
    assert.deepEqual(await types(first.client), ["JOB_ASSIGNED"]);
    await assign(id, second.id);
    assert.deepEqual(await types(first.client), ["JOB_ASSIGNED", "JOB_REASSIGNED"]);
    const moved = (await list(first.client)).items.find((n) => n["type"] === "JOB_REASSIGNED");
    assert.equal(moved?.["reportId"], null, "no link to a job the engineer can no longer open");
    assert.deepEqual(await types(second.client), ["JOB_ASSIGNED"]);

    // Attempt 2 (reassignment): start, photo, complete.
    assert.equal((await setStatus(second.client, id, "WORKING", 2)).status, 200);
    assert.ok((await types(citizen)).includes("REPAIR_STARTED"));
    assert.equal((await photo(second.client, id, 2)).status, 201);
    assert.equal((await setStatus(second.client, id, "COMPLETED", 2)).status, 200);
    assert.ok((await types(citizen)).includes("REPAIR_UPDATED"));
    assert.ok((await types(admin)).includes("REPAIR_AWAITING_CONFIRMATION"));
    assert.ok(!JSON.stringify((await list(citizen)).items).includes("Eng Two"), "citizens never learn who the engineer is");

    // Rework request, reopen (attempt 3), complete again, confirm.
    await admin.post(`${adminReport(id)}/feedback`, { note: "Patch the kerb edge", expectedAttempt: 2 });
    const rework = (await list(second.client)).items.find((n) => n["type"] === "REWORK_REQUESTED");
    assert.equal(rework?.["body"], "Patch the kerb edge");
    await setStatus(second.client, id, "WORKING", 2);
    await photo(second.client, id, 3);
    await setStatus(second.client, id, "COMPLETED", 3);
    assert.equal((await list(admin)).items.filter((n) => n["type"] === "REPAIR_AWAITING_CONFIRMATION").length, 2);

    const confirmed = await admin.post(`${adminReport(id)}/confirm-completion`, { expectedAttempt: 3 });
    assert.equal(confirmed.status, 200, confirmed.text);
    assert.ok((await types(citizen)).includes("REPAIR_CONFIRMED"));
    assert.ok((await types(second.client)).includes("REPAIR_CONFIRMED"));
    assert.ok(!(await types(first.client)).includes("REPAIR_CONFIRMED"));

    // A stale action is refused and adds nothing.
    const before = (await list(second.client)).total;
    assert.equal((await admin.post(`${adminReport(id)}/feedback`, { note: "again", expectedAttempt: 3 })).status, 409);
    assert.equal((await list(second.client)).total, before);
  });

  it("users can only read and update their own notifications", async () => {
    const id = await submitReport(citizen);
    const citizen2 = await createVerifiedCitizen(ctx, numbers.citizen2);
    assert.equal((await list(citizen2)).total, 0, "another citizen sees nothing");

    const adminItem = (await list(admin)).items[0];
    const mineId = String((await list(citizen)).items[0]?.["id"]);
    // Someone else's notification id: 404, and it stays unread for its owner.
    assert.equal((await citizen.post(`/api/v1/notifications/${String(adminItem?.["id"])}/read`)).status, 404);
    assert.equal(await unread(admin), 1);

    const marked = await citizen.post(`/api/v1/notifications/${mineId}/read`);
    assert.equal(marked.status, 200);
    assert.equal(marked.body.data?.["unread"], 0);
    assert.notEqual((await list(citizen)).items[0]?.["readAt"], null);
    // Marking again is harmless.
    assert.equal((await citizen.post(`/api/v1/notifications/${mineId}/read`)).status, 200);
    // State-changing calls need the CSRF token like every other POST.
    assert.equal((await citizen.request("POST", `/api/v1/notifications/${mineId}/read`, undefined, { csrf: false })).status, 403);
    assert.ok(id.length > 0);
  });

  it("mark all as read clears only the caller's notifications; the list is paginated newest first", async () => {
    await submitReport(citizen);
    await submitReport(citizen);
    await submitReport(citizen);
    assert.equal(await unread(citizen), 3);
    assert.equal(await unread(admin), 3);
    const page = await citizen.get("/api/v1/notifications?page=1&pageSize=2");
    const data = page.body.data as unknown as { items: Json[]; total: number; pageSize: number };
    assert.deepEqual([data.items.length, data.total, data.pageSize], [2, 3, 2]);
    assert.ok(String(data.items[0]?.["createdAt"]) >= String(data.items[1]?.["createdAt"]));

    assert.equal((await citizen.post("/api/v1/notifications/read-all")).status, 200);
    assert.equal(await unread(citizen), 0);
    assert.equal(await unread(admin), 3, "other users are untouched");
  });

  it("chat keeps one notification per conversation, refreshed by new messages and cleared on open", async () => {
    const { client: engineer, id: engineerId } = await createActiveEngineer(ctx, admin);
    const adminId = String(((await admin.get("/api/v1/auth/me")).body.data?.["user"] as Json)["id"]);
    const opened = await admin.post("/api/v1/chat/conversations", { userId: engineerId });
    const conversationId = String((opened.body.data?.["conversation"] as Json)["id"]);
    const socket = await connectOk(ctx.server.baseUrl, admin);
    sockets.push(socket);

    const first = socket.send(conversationId, "First message");
    await socket.waitFor((f) => f.type === "ack" && f["clientId"] === first);
    // The same clientId again (a retry) stores nothing new.
    socket.send(conversationId, "First message", first);
    const second = socket.send(conversationId, "Second message");
    await socket.waitFor((f) => f.type === "ack" && f["clientId"] === second);

    const items = (await list(engineer)).items.filter((n) => n["type"] === "CHAT_MESSAGE");
    assert.equal(items.length, 1, "one row per conversation, not per message");
    assert.equal(items[0]?.["body"], "Second message");
    assert.equal(items[0]?.["conversationId"], conversationId);
    assert.equal(items[0]?.["chatWithUserId"], adminId);
    assert.equal(await unread(engineer), 1);
    assert.equal((await list(admin)).items.filter((n) => n["type"] === "CHAT_MESSAGE").length, 0, "the sender is not notified");

    assert.equal((await engineer.post(`/api/v1/notifications/conversations/${conversationId}/read`)).status, 200);
    assert.equal(await unread(engineer), 0);

    const third = socket.send(conversationId, "Third message");
    await socket.waitFor((f) => f.type === "ack" && f["clientId"] === third);
    assert.equal(await unread(engineer), 1, "a new message makes it unread again");
    assert.equal((await list(engineer)).items.filter((n) => n["type"] === "CHAT_MESSAGE").length, 1);
  });

  it("admin system status reports the AI service without internal details; other roles are refused", async () => {
    const online = await admin.get("/api/v1/admin/system-status");
    assert.equal(online.status, 200);
    assert.deepEqual(online.body.data?.["ai"], { status: "online", modelLoaded: true });
    ctx.ai.healthStatus = { status: "offline", modelLoaded: null };
    assert.deepEqual((await admin.get("/api/v1/admin/system-status")).body.data?.["ai"], { status: "offline", modelLoaded: null });
    assert.equal((await citizen.get("/api/v1/admin/system-status")).status, 403);
  });

  it("admin map returns report points with the list filters; citizens are refused", async () => {
    const id = await submitReport(citizen);
    const res = await admin.get("/api/v1/admin/reports/map?status=SUBMITTED");
    assert.equal(res.status, 200, res.text);
    const data = res.body.data as unknown as { points: Json[]; total: number; truncated: boolean };
    assert.deepEqual([data.points.length, data.total, data.truncated], [1, 1, false]);
    assert.equal(data.points[0]?.["id"], id);
    assert.deepEqual([(data.points[0]?.["location"] as Json)["latitude"], (data.points[0]?.["location"] as Json)["longitude"]], [31.5204, 74.3587]);
    assert.equal(((await admin.get("/api/v1/admin/reports/map?status=COMPLETED")).body.data as unknown as { total: number }).total, 0);
    assert.equal((await citizen.get("/api/v1/admin/reports/map")).status, 403);
  });
});

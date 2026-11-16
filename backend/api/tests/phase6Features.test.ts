import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { AiServiceError } from "../src/services/ai/aiClient.js";
import { createLogger, runWithRequestId, sanitize } from "../src/utils/logger.js";
import { createVerifiedCitizen, numbers, startAuthTestApp, type AuthTestContext, type TestClient } from "./helpers/authTestApp.js";
import { detection } from "./helpers/fakeAi.js";
import { setupTestDatabase, skipWithoutDatabase, type TestDatabase } from "./helpers/testDb.js";
import { makeJpeg } from "./helpers/testImages.js";
import { acceptedReport, createActiveEngineer, reportOf, setupAdmin, submitReport, type Json } from "./helpers/workflowFixtures.js";

describe("structured logging", () => {
  it("writes one JSON object per line with the request id and redacts sensitive fields", () => {
    const lines: string[] = [];
    const log = createLogger({ write: (_level, line) => lines.push(line) });
    runWithRequestId("req-12345678", () => {
      log.info("example_event", {
        userId: "u1",
        password: "hunter2",
        nested: { accessToken: "abc", otpCode: "987654", keep: "visible" },
        error: new Error("boom"),
      });
    });
    log.debug("hidden_below_info");
    assert.equal(lines.length, 1);
    const entry = JSON.parse(lines[0] ?? "") as Json;
    assert.deepEqual([entry["level"], entry["event"], entry["requestId"], entry["userId"]], ["info", "example_event", "req-12345678", "u1"]);
    assert.equal(entry["password"], "[redacted]");
    assert.deepEqual(entry["nested"], { accessToken: "[redacted]", otpCode: "[redacted]", keep: "visible" });
    assert.equal((entry["error"] as Json)["message"], "boom");
    assert.ok(!lines[0]?.includes("hunter2") && !lines[0]?.includes("987654"));
    assert.equal(sanitize(Buffer.from("image-bytes")), "[binary 11 bytes]");
  });
});

describe("Phase 6 web features", { skip: skipWithoutDatabase }, () => {
  let db: TestDatabase;
  let ctx: AuthTestContext;
  let admin: TestClient;
  let citizen: TestClient;

  const adminReport = (id: string) => `/api/v1/admin/reports/${id}`;
  const listIds = async (query: string): Promise<string[]> => {
    const res = await admin.get(`/api/v1/admin/reports?${query}`);
    assert.equal(res.status, 200, res.text);
    return ((res.body.data?.["items"] as Json[]) ?? []).map((item) => String(item["id"]));
  };
  async function submitAt(client: TestClient, latitude: number, longitude: number): Promise<string> {
    const form = new FormData();
    form.append("captureMethod", "GALLERY_UPLOAD");
    form.append("latitude", String(latitude));
    form.append("longitude", String(longitude));
    form.append("image", new Blob([new Uint8Array(await makeJpeg())], { type: "image/jpeg" }), "road.jpg");
    const res = await client.postForm("/api/v1/reports", form);
    assert.equal(res.status, 201, res.text);
    return String((res.body.data?.["report"] as Json)["id"]);
  }
  const setSeverity = (id: string, severity: string) => admin.patch(`${adminReport(id)}/severity`, { severity });

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

  it("every response carries a request id; a well-formed client id is echoed", async () => {
    const res = await fetch(`${ctx.server.baseUrl}/api/health`);
    assert.match(res.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/);
    const echoed = await fetch(`${ctx.server.baseUrl}/api/health`, { headers: { "X-Request-Id": "client-id-12345" } });
    assert.equal(echoed.headers.get("x-request-id"), "client-id-12345");
    const replaced = await fetch(`${ctx.server.baseUrl}/api/health`, { headers: { "X-Request-Id": "bad id\twith spaces" } });
    assert.notEqual(replaced.headers.get("x-request-id"), "bad id\twith spaces");
  });

  it("sorts by effective severity (admin correction wins), longest waiting inside each level, none last, with paging", async () => {
    const a = await submitReport(citizen); // none
    const b = await submitReport(citizen); // LOW
    const c = await submitReport(citizen); // HIGH
    const d = await submitReport(citizen); // MEDIUM
    const e = await submitReport(citizen); // HIGH (newer than c)
    await setSeverity(b, "LOW");
    await setSeverity(c, "HIGH");
    await setSeverity(d, "MEDIUM");
    await setSeverity(e, "HIGH");
    assert.deepEqual(await listIds("sort=severity"), [c, e, d, b, a]);
    assert.deepEqual(await listIds("sort=severity&pageSize=2&page=1"), [c, e]);
    assert.deepEqual(await listIds("sort=severity&pageSize=2&page=2"), [d, b]);
    assert.deepEqual(await listIds("sort=severity&pageSize=2&page=3"), [a]);
    assert.deepEqual(await listIds("sort=severity&severity=HIGH"), [c, e], "works together with filters");
    const res = await admin.get("/api/v1/admin/reports?sort=severity&pageSize=2");
    assert.equal(res.body.data?.["total"], 5);
    assert.equal((await admin.get("/api/v1/admin/reports?sort=priority")).status, 400);
  });

  it("sorts by longest waiting: open reports only, oldest first; an explicit status filter is respected", async () => {
    const first = await submitReport(citizen);
    const rejected = await submitReport(citizen);
    const third = await submitReport(citizen);
    await admin.post(`${adminReport(rejected)}/review`);
    await admin.post(`${adminReport(rejected)}/decision`, { decision: "REJECT", reason: "Not a road" });
    assert.deepEqual(await listIds("sort=waiting"), [first, third], "closed reports are not waiting");
    assert.deepEqual(await listIds("sort=waiting&status=REJECTED"), [rejected]);
  });

  it("suggests possible duplicates within 50 m and 30 days, as a hint only", async () => {
    const citizen2 = await createVerifiedCitizen(ctx, numbers.citizen2);
    const base = await submitAt(citizen, 31.5204, 74.3587);
    const near = await submitAt(citizen2, 31.52065, 74.3587); // about 28 m north
    const far = await submitAt(citizen2, 31.5214, 74.3587); // about 111 m north
    const old = await submitAt(citizen2, 31.5204, 74.35872); // close, but made 40 days older below
    await db.prisma.report.update({ where: { id: old }, data: { createdAt: new Date(Date.now() - 40 * 86_400_000) } });

    const res = await admin.get(`${adminReport(base)}/possible-duplicates`);
    assert.equal(res.status, 200, res.text);
    const data = res.body.data as unknown as { criteria: Json; matches: Json[] };
    assert.deepEqual(data.criteria, { radiusMeters: 50, windowDays: 30 });
    assert.deepEqual(data.matches.map((m) => m["id"]), [near]);
    const distance = Number(data.matches[0]?.["distanceMeters"]);
    assert.ok(distance > 20 && distance < 35, `distance ${distance}`);
    assert.ok(!data.matches.some((m) => m["id"] === far || m["id"] === old || m["id"] === base));

    // Nothing was changed, merged or blocked by the hint.
    for (const id of [base, near, far, old]) {
      assert.equal(reportOf(await admin.get(adminReport(id)))["status"], "SUBMITTED");
    }
    assert.equal(await db.prisma.report.count(), 4);
    // Admin only; citizens and engineers never see other people's reports through it.
    assert.equal((await citizen.get(`${adminReport(base)}/possible-duplicates`)).status, 403);
    const { client: engineer } = await createActiveEngineer(ctx, admin);
    assert.equal((await engineer.get(`${adminReport(base)}/possible-duplicates`)).status, 403);
    assert.equal((await admin.get(`${adminReport("00000000-0000-4000-8000-000000000000")}/possible-duplicates`)).status, 404);
  });

  it("retries a failed analysis: stores detections and the estimate, keeps the admin's severity and the status", async () => {
    ctx.ai.failWith = new AiServiceError("unavailable", "simulated");
    const id = await submitReport(citizen);
    await admin.post(`${adminReport(id)}/review`);
    await admin.post(`${adminReport(id)}/decision`, { decision: "DELAY", reason: "Waiting for budget" });
    await setSeverity(id, "HIGH");
    const before = reportOf(await admin.get(adminReport(id)));
    assert.equal((before["allowedActions"] as Json)["retryAnalysis"], true);
    const historyBefore = (before["statusHistory"] as Json[]).length;

    // Still failing: nothing changes except the latest error; it can be tried again.
    ctx.ai.failWith = new AiServiceError("timeout", "simulated");
    const failed = await admin.post(`${adminReport(id)}/retry-analysis`);
    assert.equal(failed.status, 200, failed.text);
    assert.equal(failed.body.data?.["analysis"], "failed");
    assert.deepEqual([(reportOf(failed)["analysis"] as Json)["status"], (reportOf(failed)["analysis"] as Json)["errorCode"]], ["FAILED", "timeout"]);

    ctx.ai.failWith = undefined;
    ctx.ai.detections = [detection("pothole", 0.9, [10, 10, 200, 200])];
    const ok = await admin.post(`${adminReport(id)}/retry-analysis`);
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.body.data?.["analysis"], "completed");
    const report = reportOf(ok);
    const analysis = report["analysis"] as Json;
    assert.deepEqual([analysis["status"], analysis["errorCode"], (analysis["detections"] as Json[]).length], ["COMPLETED", null, 1]);
    const severity = report["severity"] as Json;
    assert.notEqual(severity["ai"], null, "the automatic estimate is now stored");
    assert.deepEqual([severity["admin"], severity["effective"]], ["HIGH", "HIGH"], "the admin's severity is untouched");
    assert.equal(report["status"], "DELAYED");
    assert.equal((report["statusHistory"] as Json[]).length, historyBefore, "no status history is added");
    assert.equal((report["allowedActions"] as Json)["retryAnalysis"], false);
    // The citizen still sees the delay reason, not anything about the retry.
    assert.equal(reportOf(await citizen.get(`/api/v1/reports/${id}`))["decisionReason"], "Waiting for budget");

    // Not retryable any more, and never for other roles.
    assert.equal((await admin.post(`${adminReport(id)}/retry-analysis`)).status, 409);
    assert.equal((await citizen.post(`${adminReport(id)}/retry-analysis`)).status, 403);
    assert.equal(await db.prisma.aiDetection.count({ where: { reportId: id } }), 1);
  });

  it("two simultaneous retries analyse once and never store detections twice", async () => {
    ctx.ai.failWith = new AiServiceError("unavailable", "simulated");
    const id = await submitReport(citizen);
    ctx.ai.failWith = undefined;
    ctx.ai.detections = [detection("pothole", 0.8, [10, 10, 100, 100])];
    const results = await Promise.all([admin.post(`${adminReport(id)}/retry-analysis`), admin.post(`${adminReport(id)}/retry-analysis`)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(await db.prisma.aiDetection.count({ where: { reportId: id } }), 1);
  });

  it("analytics reports turnaround from the status history, once per report", async () => {
    const empty = (await admin.get("/api/v1/admin/analytics")).body.data?.["analytics"] as Json;
    assert.deepEqual((empty["turnaround"] as Json)["toReview"], { reports: 0, medianHours: null, averageHours: null });

    const id = await submitReport(citizen);
    const other = await submitReport(citizen);
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
    // Report 1: submitted 10 h ago, review after 2 h, delayed after 4 h (kept delayed later), accepted after 6 h.
    await db.prisma.report.update({ where: { id }, data: { createdAt: hoursAgo(10), status: "ACCEPTED" } });
    await db.prisma.reportStatusHistory.createMany({
      data: [
        { reportId: id, fromStatus: "SUBMITTED", toStatus: "UNDER_REVIEW", createdAt: hoursAgo(8) },
        { reportId: id, fromStatus: "UNDER_REVIEW", toStatus: "DELAYED", createdAt: hoursAgo(6) },
        { reportId: id, fromStatus: "DELAYED", toStatus: "DELAYED", createdAt: hoursAgo(5) },
        { reportId: id, fromStatus: "DELAYED", toStatus: "ACCEPTED", createdAt: hoursAgo(4) },
      ],
    });
    // Report 2: submitted 10 h ago, review after 4 h, never decided.
    await db.prisma.report.update({ where: { id: other }, data: { createdAt: hoursAgo(10), status: "UNDER_REVIEW" } });
    await db.prisma.reportStatusHistory.create({ data: { reportId: other, fromStatus: "SUBMITTED", toStatus: "UNDER_REVIEW", createdAt: hoursAgo(6) } });

    const turnaround = ((await admin.get("/api/v1/admin/analytics")).body.data?.["analytics"] as Json)["turnaround"] as Json;
    assert.deepEqual(turnaround["toReview"], { reports: 2, medianHours: 3, averageHours: 3 });
    assert.deepEqual(turnaround["toDecision"], { reports: 1, medianHours: 4, averageHours: 4 }, "the first decision only");
    assert.deepEqual(turnaround["toCompletion"], { reports: 0, medianHours: null, averageHours: null });
  });

  it("engineers get the location of their own jobs only", async () => {
    const mine = await acceptedReport(admin, citizen);
    const notMine = await acceptedReport(admin, citizen);
    const first = await createActiveEngineer(ctx, admin, numbers.engineer, "Eng One");
    const second = await createActiveEngineer(ctx, admin, numbers.engineer2, "Eng Two");
    await admin.post(`${adminReport(mine)}/assignment`, { engineerId: first.id });
    await admin.post(`${adminReport(notMine)}/assignment`, { engineerId: second.id });
    const jobs = ((await first.client.get("/api/v1/engineer/jobs?scope=active")).body.data?.["items"] as Json[]) ?? [];
    assert.deepEqual(jobs.map((j) => j["id"]), [mine]);
    assert.deepEqual(jobs[0]?.["location"], { latitude: 31.5204, longitude: 74.3587 });
    const text = JSON.stringify(jobs);
    assert.ok(!text.includes("Test Citizen") && !text.includes("exif") && !text.includes(notMine), "no citizen identity, EXIF or other engineers' jobs");
  });
});

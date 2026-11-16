import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it, mock } from "node:test";
import { createVerifiedCitizen, numbers, startAuthTestApp, type AuthTestContext, type TestClient } from "./helpers/authTestApp.js";
import { setupTestDatabase, skipWithoutDatabase, type TestDatabase } from "./helpers/testDb.js";
import {
  acceptedReport,
  citizenSms,
  createActiveEngineer,
  reportOf,
  setupAdmin,
  submitReport,
  type Json,
} from "./helpers/workflowFixtures.js";

describe("admin report workflow (review, decisions, severity)", { skip: skipWithoutDatabase }, () => {
  let db: TestDatabase;
  let ctx: AuthTestContext;
  let admin: TestClient;
  let citizen: TestClient;

  const base = (id: string) => `/api/v1/admin/reports/${id}`;
  const history = (reportId: string) =>
    db.prisma.reportStatusHistory.findMany({ where: { reportId }, orderBy: { createdAt: "asc" }, select: { fromStatus: true, toStatus: true, note: true } });

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
    ctx.sms.messages.length = 0;
    ctx.sms.failWith = undefined;
    admin = await setupAdmin(db, ctx);
    citizen = await createVerifiedCitizen(ctx);
  });

  describe("authorization", () => {
    it("allows only admins on every admin report endpoint", async () => {
      const id = await submitReport(citizen);
      const { client: engineer } = await createActiveEngineer(ctx, admin);
      const anonymous = ctx.client();
      const calls: [string, string, Json?][] = [
        ["GET", "/api/v1/admin/dashboard"],
        ["GET", "/api/v1/admin/reports"],
        ["GET", base(id)],
        ["POST", `${base(id)}/review`, {}],
        ["POST", `${base(id)}/decision`, { decision: "ACCEPT" }],
        ["PATCH", `${base(id)}/severity`, { severity: "HIGH" }],
        ["POST", `${base(id)}/feedback`, { note: "x", expectedAttempt: 1 }],
        ["POST", `${base(id)}/confirm-completion`, { expectedAttempt: 1 }],
      ];
      for (const [method, path, body] of calls) {
        assert.equal((await anonymous.request(method, path, body)).status, 401, `anonymous ${method} ${path}`);
        assert.equal((await citizen.request(method, path, body)).status, 403, `citizen ${method} ${path}`);
        assert.equal((await engineer.request(method, path, body)).status, 403, `engineer ${method} ${path}`);
      }
      const row = await db.prisma.report.findUniqueOrThrow({ where: { id } });
      assert.equal(row.status, "SUBMITTED", "nothing changed");
    });

    it("requires the CSRF token for admin actions", async () => {
      const id = await submitReport(citizen);
      const res = await admin.request("POST", `${base(id)}/review`, {}, { csrf: false });
      assert.equal(res.status, 403);
      assert.equal(res.body.error?.code, "CSRF_TOKEN_INVALID");
    });
  });

  describe("review and decisions", () => {
    it("opening a report changes nothing; Review moves SUBMITTED to UNDER_REVIEW once", async () => {
      const id = await submitReport(citizen);
      const opened = await admin.get(base(id));
      assert.equal(opened.status, 200);
      assert.equal(reportOf(opened)["status"], "SUBMITTED");
      assert.deepEqual(reportOf(opened)["allowedActions"], {
        review: true,
        decide: false,
        assign: false,
        feedback: false,
        confirmCompletion: false,
        retryAnalysis: false,
      });
      assert.equal((await db.prisma.report.findUniqueOrThrow({ where: { id } })).status, "SUBMITTED");

      const reviewed = await admin.post(`${base(id)}/review`);
      assert.equal(reviewed.status, 200);
      assert.equal(reportOf(reviewed)["status"], "UNDER_REVIEW");
      const again = await admin.post(`${base(id)}/review`);
      assert.equal(again.status, 409);
      assert.equal(again.body.error?.code, "INVALID_TRANSITION");
      assert.deepEqual((await history(id)).map((h) => `${h.fromStatus}→${h.toStatus}`), ["null→SUBMITTED", "SUBMITTED→UNDER_REVIEW"]);
      assert.deepEqual(citizenSms(ctx, numbers.citizen), [], "no SMS for Review");
    });

    it("cannot decide before Review", async () => {
      const id = await submitReport(citizen);
      const res = await admin.post(`${base(id)}/decision`, { decision: "ACCEPT" });
      assert.equal(res.status, 409);
      assert.equal(res.body.error?.code, "INVALID_TRANSITION");
    });

    it("accepts with an optional note and sends exactly one SMS without coordinates", async () => {
      const id = await submitReport(citizen);
      await admin.post(`${base(id)}/review`);
      const res = await admin.post(`${base(id)}/decision`, { decision: "ACCEPT", reason: "Confirmed on site photos" });
      assert.equal(res.status, 200);
      assert.equal(res.body.data?.["notification"], "sent");
      assert.equal(reportOf(res)["status"], "ACCEPTED");
      const sms = citizenSms(ctx, numbers.citizen);
      assert.equal(sms.length, 1);
      assert.match(sms[0] ?? "", /was accepted/);
      assert.ok(!/31\.52|74\.35/.test(sms[0] ?? ""), "no coordinates in SMS");
      assert.equal((await history(id)).at(-1)?.note, "Confirmed on site photos");
    });

    it("requires a reason to reject or delay", async () => {
      const id = await submitReport(citizen);
      await admin.post(`${base(id)}/review`);
      for (const body of [{ decision: "REJECT" }, { decision: "DELAY", reason: "   " }, { decision: "REJECT", reason: "x".repeat(501) }]) {
        const res = await admin.post(`${base(id)}/decision`, body);
        assert.equal(res.status, 400, JSON.stringify(body).slice(0, 60));
        assert.equal(res.body.error?.code, "VALIDATION_ERROR");
      }
      assert.equal((await db.prisma.report.findUniqueOrThrow({ where: { id } })).status, "UNDER_REVIEW");
    });

    it("rejects with a reason that the citizen sees and receives (shortened) by SMS", async () => {
      const id = await submitReport(citizen);
      await admin.post(`${base(id)}/review`);
      const reason = `Duplicate of an existing report. ${"Details ".repeat(30)}`;
      const res = await admin.post(`${base(id)}/decision`, { decision: "REJECT", reason });
      assert.equal(res.status, 200);
      const mine = await citizen.get(`/api/v1/reports/${id}`);
      assert.equal(reportOf(mine)["status"], "REJECTED");
      assert.equal(reportOf(mine)["decisionReason"], reason.trim());
      const sms = citizenSms(ctx, numbers.citizen);
      assert.equal(sms.length, 1);
      assert.match(sms[0] ?? "", /not accepted\. Reason: Duplicate/);
      assert.ok((sms[0] ?? "").length < reason.length, "reason shortened in SMS");
      // Rejected is final.
      assert.equal((await admin.post(`${base(id)}/decision`, { decision: "ACCEPT" })).status, 409);
    });

    it("keep delayed: records the new reason as a history event, shows it to the citizen, sends no SMS", async () => {
      const id = await submitReport(citizen);
      await admin.post(`${base(id)}/review`);
      assert.equal((await admin.post(`${base(id)}/decision`, { decision: "DELAY", reason: "Waiting for budget" })).status, 200);
      assert.equal(citizenSms(ctx, numbers.citizen).length, 1, "first delay sends an SMS");

      const kept = await admin.post(`${base(id)}/decision`, { decision: "DELAY", reason: "Rainy season, scheduled for March" });
      assert.equal(kept.status, 200);
      assert.equal(kept.body.data?.["notification"], undefined, "no SMS was due");
      assert.equal(reportOf(kept)["status"], "DELAYED");
      assert.equal(citizenSms(ctx, numbers.citizen).length, 1, "keep delayed sends no SMS");
      const rows = await history(id);
      assert.deepEqual(rows.at(-1), { fromStatus: "DELAYED", toStatus: "DELAYED", note: "Rainy season, scheduled for March" });
      assert.equal(reportOf(await citizen.get(`/api/v1/reports/${id}`))["decisionReason"], "Rainy season, scheduled for March");

      // Keep delayed also needs a reason.
      assert.equal((await admin.post(`${base(id)}/decision`, { decision: "DELAY" })).status, 400);

      // Re-review: accept directly from DELAYED → exactly one more SMS; old delay reason no longer shown.
      const accepted = await admin.post(`${base(id)}/decision`, { decision: "ACCEPT" });
      assert.equal(accepted.status, 200);
      assert.equal(citizenSms(ctx, numbers.citizen).length, 2);
      assert.equal(reportOf(await citizen.get(`/api/v1/reports/${id}`))["decisionReason"], null);
      assert.equal(reportOf(await citizen.get(`/api/v1/reports/${id}`))["repairProgress"], "NOT_ASSIGNED");
    });

    it("concurrent and retried decisions change the report once and send one SMS", async () => {
      const id = await submitReport(citizen);
      await admin.post(`${base(id)}/review`);
      const second = await setupAdmin(db, ctx, numbers.engineer2);
      const results = await Promise.all([
        admin.post(`${base(id)}/decision`, { decision: "ACCEPT" }),
        second.post(`${base(id)}/decision`, { decision: "REJECT", reason: "Not road damage" }),
      ]);
      const statuses = results.map((r) => r.status).sort();
      assert.deepEqual(statuses, [200, 409]);
      const loser = results.find((r) => r.status === 409);
      assert.ok(loser?.body.error?.code === "REPORT_STATE_CONFLICT" || loser?.body.error?.code === "INVALID_TRANSITION");
      assert.equal(citizenSms(ctx, numbers.citizen).length, 1, "only the winning decision notifies");
      assert.equal((await history(id)).length, 3, "submitted, reviewed, one decision");

      // A retry of the same decision (e.g. after a lost response) is refused and sends nothing.
      const winner = results.find((r) => r.status === 200);
      const retryBody = reportOf(winner!)["status"] === "ACCEPTED" ? { decision: "ACCEPT" } : { decision: "REJECT", reason: "Not road damage" };
      const retry = await admin.post(`${base(id)}/decision`, retryBody);
      assert.equal(retry.status, 409);
      assert.equal(citizenSms(ctx, numbers.citizen).length, 1);
    });

    it("keeps the decision when the SMS fails, reports it and logs a masked number", async () => {
      const id = await submitReport(citizen);
      await admin.post(`${base(id)}/review`);
      ctx.sms.failWith = new Error("provider down");
      // Warnings are structured JSON lines on stderr (utils/logger.ts).
      const warn = mock.method(process.stderr, "write", () => true);
      try {
        const res = await admin.post(`${base(id)}/decision`, { decision: "DELAY", reason: "Waiting for materials" });
        assert.equal(res.status, 200);
        assert.equal(res.body.data?.["notification"], "failed");
        assert.equal(reportOf(res)["status"], "DELAYED");
        const logged = warn.mock.calls.map((c) => String(c.arguments[0])).join("\n");
        assert.match(logged, /"event":"citizen_sms_failed"/);
        assert.match(logged, /"status":"DELAYED"/);
        assert.ok(!logged.includes(numbers.citizen), "full number never logged");
        assert.match(logged, /\*+101/);
      } finally {
        warn.mock.restore();
      }
      assert.equal((await db.prisma.report.findUniqueOrThrow({ where: { id } })).status, "DELAYED");
    });

    it("corrects severity while keeping the AI estimate", async () => {
      const id = await submitReport(citizen);
      const res = await admin.patch(`${base(id)}/severity`, { severity: "HIGH" });
      assert.equal(res.status, 200);
      const severity = reportOf(res)["severity"] as Json;
      assert.equal(severity["ai"], null, "fake AI found no damage");
      assert.equal(severity["admin"], "HIGH");
      assert.equal(severity["effective"], "HIGH");
      assert.equal((severity["adminSetBy"] as Json)["fullName"], "Admin 110");
      assert.deepEqual(citizenSms(ctx, numbers.citizen), [], "no SMS for a severity correction");
      assert.equal((await admin.patch(`${base(id)}/severity`, { severity: "SEVERE" })).status, 400);
    });

    it("confirm and feedback are refused unless a repair is awaiting confirmation", async () => {
      const id = await acceptedReport(admin, citizen);
      const confirm = await admin.post(`${base(id)}/confirm-completion`, { expectedAttempt: 1 });
      assert.equal(confirm.status, 409);
      assert.equal(confirm.body.error?.code, "INVALID_TRANSITION");
      const feedback = await admin.post(`${base(id)}/feedback`, { note: "Redo the edges", expectedAttempt: 1 });
      assert.equal(feedback.status, 409);
      assert.equal(feedback.body.error?.code, "INVALID_TRANSITION");
      assert.equal(await db.prisma.repairUpdate.count(), 0);
    });

    it("returns 404 for unknown reports and 400 for invalid ids", async () => {
      assert.equal((await admin.get(base("00000000-0000-4000-8000-000000000000"))).status, 404);
      assert.equal((await admin.get(base("nope"))).status, 400);
      assert.equal((await admin.post(`${base("00000000-0000-4000-8000-000000000000")}/review`)).status, 404);
    });
  });

  describe("list, detail and dashboard", () => {
    it("filters, searches and paginates all reports", async () => {
      const a = await submitReport(citizen, "Huge pothole near the mosque");
      const b = await submitReport(citizen);
      const other = await createVerifiedCitizen(ctx, numbers.citizen2);
      const c = await submitReport(other);
      await admin.post(`${base(b)}/review`);
      await admin.patch(`${base(c)}/severity`, { severity: "HIGH" });

      const ids = async (query: string) =>
        ((await admin.get(`/api/v1/admin/reports${query}`)).body.data?.["items"] as Json[]).map((r) => r["id"]);
      assert.deepEqual(await ids(""), [c, b, a]);
      assert.deepEqual(await ids("?sort=oldest&pageSize=2"), [a, b]);
      assert.deepEqual(await ids("?status=UNDER_REVIEW"), [b]);
      assert.deepEqual(await ids("?severity=HIGH"), [c]);
      assert.deepEqual(await ids("?search=mosque"), [a]);
      assert.deepEqual(await ids(`?search=${encodeURIComponent(numbers.citizen2)}`), [c]);
      assert.deepEqual(await ids(`?search=${c}`), [c]);
      assert.deepEqual(await ids("?assignment=unassigned&needsLocationReview=true&aiStatus=COMPLETED&captureMethod=GALLERY_UPLOAD"), [c, b, a]);
      const today = new Date().toISOString().slice(0, 10);
      assert.deepEqual(await ids(`?from=${today}&to=${today}`), [c, b, a]);
      assert.deepEqual(await ids("?to=2000-01-01"), []);

      const list = await admin.get("/api/v1/admin/reports?pageSize=1&page=2");
      assert.equal(list.body.data?.["total"], 3);
      const item = (list.body.data?.["items"] as Json[])[0] as Json;
      assert.equal((item["citizen"] as Json)["fullName"], "Test Citizen");
      for (const bad of ["pageSize=51", "status=OPEN", "from=2026-13-01", "from=2026-02-02&to=2026-02-01", "engineerId=x", "extra=1"]) {
        assert.equal((await admin.get(`/api/v1/admin/reports?${bad}`)).status, 400, bad);
      }
    });

    it("shows admins the citizen, EXIF data and full history, which citizens never see", async () => {
      const id = await submitReport(citizen);
      const detail = reportOf(await admin.get(base(id)));
      assert.equal((detail["citizen"] as Json)["mobileNumber"], numbers.citizen);
      assert.equal((detail["assignment"] as Json)["status"], "UNASSIGNED");
      assert.deepEqual(detail["repairAttempts"], []);
      assert.equal((detail["statusHistory"] as Json[]).length, 1);
      const citizenView = await citizen.get(`/api/v1/reports/${id}`);
      assert.ok(!citizenView.text.includes("mobileNumber") && !citizenView.text.includes("statusHistory"));
    });

    it("counts reports by status, effective severity and work queues", async () => {
      const toReview = await submitReport(citizen);
      const delayed = await submitReport(citizen);
      await admin.post(`${base(delayed)}/review`);
      await admin.post(`${base(delayed)}/decision`, { decision: "DELAY", reason: "Later" });
      const accepted = await acceptedReport(admin, citizen);
      await admin.patch(`${base(accepted)}/severity`, { severity: "MEDIUM" });
      await createActiveEngineer(ctx, admin);

      const res = await admin.get("/api/v1/admin/dashboard");
      assert.equal(res.status, 200);
      const d = res.body.data?.["dashboard"] as Json;
      assert.equal(d["total"], 3);
      assert.deepEqual(d["byStatus"], { SUBMITTED: 1, UNDER_REVIEW: 0, ACCEPTED: 1, REJECTED: 0, DELAYED: 1, COMPLETED: 0 });
      assert.deepEqual(d["bySeverity"], { LOW: 0, MEDIUM: 1, HIGH: 0, NONE: 2 });
      assert.deepEqual(d["queues"], {
        awaitingReview: 1,
        underReview: 0,
        delayed: 1,
        awaitingAssignment: 1,
        inProgress: 0,
        awaitingConfirmation: 0,
        locationFlagged: 3,
        aiFailed: 0,
        jobsOnDeactivatedEngineers: 0,
      });
      assert.equal(d["activeEngineers"], 1);
      assert.deepEqual((d["recent"] as Json[]).map((r) => r["id"]), [accepted, delayed, toReview]);
    });
  });
});

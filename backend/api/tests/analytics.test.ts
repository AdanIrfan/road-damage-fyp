import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { bucketCounts, defaultGranularity, periodStart } from "../src/services/analytics.service.js";
import { createVerifiedCitizen, startAuthTestApp, type AuthTestContext, type TestClient, numbers } from "./helpers/authTestApp.js";
import { detection } from "./helpers/fakeAi.js";
import { setupTestDatabase, skipWithoutDatabase, type TestDatabase } from "./helpers/testDb.js";
import { makeJpeg } from "./helpers/testImages.js";
import { createActiveEngineer, setupAdmin, submitReport, type Json } from "./helpers/workflowFixtures.js";

describe("analytics time buckets (unit)", () => {
  it("starts weeks on Monday and months on the 1st (UTC)", () => {
    const sunday = new Date("2026-11-15T23:59:00Z");
    assert.equal(periodStart(sunday, "day").toISOString(), "2026-11-15T00:00:00.000Z");
    assert.equal(periodStart(sunday, "week").toISOString(), "2026-11-09T00:00:00.000Z");
    assert.equal(periodStart(new Date("2026-11-16T00:00:00Z"), "week").toISOString(), "2026-11-16T00:00:00.000Z");
    assert.equal(periodStart(sunday, "month").toISOString(), "2026-11-01T00:00:00.000Z");
  });

  it("fills empty periods with zero and counts each date once", () => {
    const dates = ["2026-01-30T10:00:00Z", "2026-01-30T23:00:00Z", "2026-03-02T00:00:00Z"].map((d) => new Date(d));
    assert.deepEqual(bucketCounts(dates, new Date("2026-01-15T00:00:00Z"), new Date("2026-03-31T00:00:00Z"), "month"), [
      { period: "2026-01-01", count: 2 },
      { period: "2026-02-01", count: 0 },
      { period: "2026-03-01", count: 1 },
    ]);
  });

  it("chooses day, week or month from the length of the range", () => {
    const d = (s: string) => new Date(`${s}T00:00:00Z`);
    assert.equal(defaultGranularity(d("2026-01-01"), d("2026-03-03")), "day");
    assert.equal(defaultGranularity(d("2026-01-01"), d("2026-06-01")), "week");
    assert.equal(defaultGranularity(d("2024-01-01"), d("2026-06-01")), "month");
  });
});

describe("admin analytics", { skip: skipWithoutDatabase }, () => {
  let db: TestDatabase;
  let ctx: AuthTestContext;
  let admin: TestClient;
  let citizen: TestClient;

  const analytics = async (query = "") => {
    const res = await admin.get(`/api/v1/admin/analytics${query}`);
    assert.equal(res.status, 200, res.text);
    return res.body.data?.["analytics"] as Json;
  };
  const setCreated = (id: string, iso: string) => db.prisma.report.update({ where: { id }, data: { createdAt: new Date(iso) } });

  async function submitLive(accuracy: number): Promise<string> {
    const form = new FormData();
    form.append("captureMethod", "LIVE_CAMERA");
    form.append("latitude", "31.5204");
    form.append("longitude", "74.3587");
    form.append("gpsAccuracyMeters", String(accuracy));
    form.append("image", new Blob([new Uint8Array(await makeJpeg())], { type: "image/jpeg" }), "live.jpg");
    const res = await citizen.postForm("/api/v1/reports", form);
    assert.equal(res.status, 201, res.text);
    return String((res.body.data?.["report"] as Json)["id"]);
  }

  const review = async (id: string) => assert.equal((await admin.post(`/api/v1/admin/reports/${id}/review`)).status, 200);
  const decide = async (id: string, decision: string, reason?: string) => {
    const res = await admin.post(`/api/v1/admin/reports/${id}/decision`, reason === undefined ? { decision } : { decision, reason });
    assert.equal(res.status, 200, res.text);
  };
  const assign = async (id: string, engineerId: string) => {
    const res = await admin.post(`/api/v1/admin/reports/${id}/assignment`, { engineerId });
    assert.equal(res.status, 200, res.text);
  };

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

  it("is available to admins only", async () => {
    assert.equal((await ctx.client().get("/api/v1/admin/analytics")).status, 401);
    const citizenRes = await citizen.get("/api/v1/admin/analytics");
    assert.deepEqual([citizenRes.status, citizenRes.body.error?.code], [403, "FORBIDDEN"]);
    const engineer = await createActiveEngineer(ctx, admin);
    assert.equal((await engineer.client.get("/api/v1/admin/analytics")).status, 403);
  });

  it("answers an empty database with zeros and empty lists", async () => {
    const data = await analytics("?from=2026-11-01&to=2026-11-03");
    assert.equal(data["total"], 0);
    assert.deepEqual(data["overTime"], [
      { period: "2026-11-01", count: 0 },
      { period: "2026-11-02", count: 0 },
      { period: "2026-11-03", count: 0 },
    ]);
    assert.deepEqual(data["bySeverity"], { LOW: 0, MEDIUM: 0, HIGH: 0, NONE: 0 });
    assert.deepEqual((data["damageClasses"] as Json)["byClass"], []);
    assert.deepEqual(data["engineerWorkload"], []);
    assert.equal((data["location"] as Json)["needsReview"], 0);
    const unbounded = await analytics();
    assert.equal(unbounded["total"], 0);
    assert.equal((unbounded["overTime"] as unknown[]).length, 1, "an empty all-time range is just today");
  });

  it("aggregates real report data once per report, with effective severity and current repair state", async () => {
    const eng1 = await createActiveEngineer(ctx, admin, numbers.engineer, "Alpha Eng");
    const eng2 = await createActiveEngineer(ctx, admin, numbers.engineer2, "Beta Eng");

    // R1: three potholes (one big) → AI HIGH, admin corrects to MEDIUM. Accepted; reassigned twice.
    ctx.ai.detections = [
      detection("pothole", 0.9, [0, 0, 100, 100]),
      detection("pothole", 0.5, [100, 0, 110, 10]),
      detection("pothole", 0.5, [120, 0, 130, 10]),
    ];
    const r1 = await submitReport(citizen);
    // R2: pothole + alligator crack → LOW. Accepted, assigned to eng2, engineer working.
    ctx.ai.detections = [detection("pothole", 0.5, [0, 0, 10, 10]), detection("alligator_crack", 0.5, [0, 0, 20, 20])];
    const r2 = await submitReport(citizen);
    // R3: analysed, nothing found. Stays submitted.
    ctx.ai.detections = [];
    const r3 = await submitReport(citizen);
    // R4: AI failed; rejected; submitted long before the others.
    ctx.ai.failWith = new Error("down");
    const r4 = await submitReport(citizen);
    ctx.ai.failWith = undefined;
    // R5 / R6: live camera, poor and good GPS accuracy. R6 is accepted and left unassigned.
    const r5 = await submitLive(350);
    const r6 = await submitLive(12);

    const r1Row = await db.prisma.report.findUniqueOrThrow({ where: { id: r1 } });
    assert.equal(r1Row.aiSeverity, "HIGH");
    assert.equal((await admin.patch(`/api/v1/admin/reports/${r1}/severity`, { severity: "MEDIUM" })).status, 200);

    for (const id of [r1, r2, r4, r6]) await review(id);
    await decide(r1, "ACCEPT");
    await decide(r2, "ACCEPT");
    await decide(r4, "REJECT", "Not a public road");
    await decide(r6, "ACCEPT");
    // R1: attempt 1 (eng1) → attempt 2 (eng2) → attempt 3 (eng1). Counted once, for eng1, as open.
    await assign(r1, eng1.id);
    await assign(r1, eng2.id);
    await assign(r1, eng1.id);
    await assign(r2, eng2.id);
    const working = await eng2.client.patch(`/api/v1/engineer/jobs/${r2}/repair-status`, { status: "WORKING", expectedAttempt: 1 });
    assert.equal(working.status, 200, working.text);
    assert.equal(await db.prisma.reportAssignment.count({ where: { reportId: r1 } }), 3);

    await setCreated(r1, "2026-11-02T08:00:00Z");
    await setCreated(r2, "2026-11-03T09:00:00Z");
    await setCreated(r3, "2026-11-03T23:59:59Z");
    await setCreated(r4, "2026-09-20T12:00:00Z");
    await setCreated(r5, "2026-11-05T00:00:00Z");
    await setCreated(r6, "2026-11-06T10:00:00Z");

    const all = await analytics();
    assert.equal(all["total"], 6);
    assert.deepEqual(all["byStatus"], { SUBMITTED: 2, UNDER_REVIEW: 0, ACCEPTED: 3, REJECTED: 1, DELAYED: 0, COMPLETED: 0 });
    assert.deepEqual(all["bySeverity"], { LOW: 1, MEDIUM: 1, HIGH: 0, NONE: 4 }, "admin correction wins over the AI value");
    assert.deepEqual(all["damageClasses"], {
      byClass: [
        { className: "pothole", reports: 2 },
        { className: "alligator_crack", reports: 1 },
      ],
      noDetections: 3,
      aiFailed: 1,
    });
    assert.deepEqual(all["repairProgress"], { unassigned: 1, pending: 1, working: 1, awaitingConfirmation: 0, completed: 0 });
    assert.deepEqual(
      (all["engineerWorkload"] as Json[]).map((w) => [w["fullName"], w["open"], w["awaitingConfirmation"], w["completed"]]),
      [
        ["Alpha Eng", 1, 0, 0],
        ["Beta Eng", 1, 0, 0],
      ],
      "reassignments and attempts do not inflate workload",
    );
    const location = all["location"] as Json;
    const byLocation = Object.fromEntries((location["byStatus"] as Json[]).map((l) => [l["status"], [l["reports"], l["needsReview"]]]));
    assert.deepEqual(byLocation, {
      VERIFIED: [0, 0],
      MISMATCH: [0, 0],
      NO_METADATA: [4, 4],
      NOT_CHECKED: [0, 0],
      BROWSER_GPS: [2, 1],
    });
    assert.equal(location["needsReview"], 5);
    // Unbounded range: the series runs from the first report to today and still counts every report once.
    assert.equal((all["overTime"] as Json[]).reduce((sum, p) => sum + Number(p["count"]), 0), 6);
    assert.equal((all["overTime"] as Json[])[0]?.["period"] !== undefined, true);

    // Date filter: 2026-11-01..2026-11-03 includes R1, R2 and R3 (the last second of the 3rd).
    const early = await analytics("?from=2026-11-01&to=2026-11-03&granularity=day");
    assert.equal(early["total"], 3);
    assert.deepEqual(early["overTime"], [
      { period: "2026-11-01", count: 0 },
      { period: "2026-11-02", count: 1 },
      { period: "2026-11-03", count: 2 },
    ]);
    assert.deepEqual(early["bySeverity"], { LOW: 1, MEDIUM: 1, HIGH: 0, NONE: 1 });
    assert.deepEqual((early["damageClasses"] as Json)["aiFailed"], 0);
    assert.deepEqual(early["repairProgress"], { unassigned: 0, pending: 1, working: 1, awaitingConfirmation: 0, completed: 0 });
    // Every active engineer is listed, even with nothing in the range.
    const late = await analytics("?from=2026-11-04&to=2026-11-30");
    assert.equal(late["total"], 2);
    assert.deepEqual((late["engineerWorkload"] as Json[]).map((w) => w["open"]), [0, 0]);
    assert.deepEqual(late["repairProgress"], { unassigned: 1, pending: 0, working: 0, awaitingConfirmation: 0, completed: 0 });
    const weekly = await analytics("?from=2026-11-01&to=2026-11-15&granularity=week");
    assert.deepEqual(weekly["overTime"], [
      { period: "2026-10-26", count: 0 },
      { period: "2026-11-02", count: 5 },
      { period: "2026-11-09", count: 0 },
    ]);
    const september = await analytics("?from=2026-09-01&to=2026-09-30");
    assert.deepEqual([september["total"], (september["byStatus"] as Json)["REJECTED"]], [1, 1]);
  });

  it("counts a confirmed repair once, after several attempts, for the engineer who did it", async () => {
    const eng = await createActiveEngineer(ctx, admin);
    const id = await submitReport(citizen);
    await review(id);
    await decide(id, "ACCEPT");
    await assign(id, eng.id);
    const job = `/api/v1/engineer/jobs/${id}`;
    const photo = async (attempt: number) => {
      const form = new FormData();
      form.append("expectedAttempt", String(attempt));
      form.append("image", new Blob([new Uint8Array(await makeJpeg(160, 120))], { type: "image/jpeg" }), "repair.jpg");
      assert.equal((await eng.client.postForm(`${job}/photos`, form)).status, 201);
    };
    assert.equal((await eng.client.patch(`${job}/repair-status`, { status: "WORKING", expectedAttempt: 1 })).status, 200);
    await photo(1);
    assert.equal((await eng.client.patch(`${job}/repair-status`, { status: "COMPLETED", expectedAttempt: 1 })).status, 200);
    const awaiting = await analytics();
    assert.deepEqual(awaiting["repairProgress"], { unassigned: 0, pending: 0, working: 0, awaitingConfirmation: 1, completed: 0 });
    assert.equal((awaiting["engineerWorkload"] as Json[])[0]?.["awaitingConfirmation"], 1);
    // Rework: reopen as attempt 2, complete again, confirm.
    assert.equal((await eng.client.patch(`${job}/repair-status`, { status: "WORKING", expectedAttempt: 1 })).status, 200);
    await photo(2);
    assert.equal((await eng.client.patch(`${job}/repair-status`, { status: "COMPLETED", expectedAttempt: 2 })).status, 200);
    assert.equal((await admin.post(`/api/v1/admin/reports/${id}/confirm-completion`, { expectedAttempt: 2 })).status, 200);

    const done = await analytics();
    assert.equal(done["total"], 1);
    assert.deepEqual(done["repairProgress"], { unassigned: 0, pending: 0, working: 0, awaitingConfirmation: 0, completed: 1 });
    const row = (done["engineerWorkload"] as Json[])[0];
    assert.deepEqual([row?.["open"], row?.["awaitingConfirmation"], row?.["completed"]], [0, 0, 1]);
    assert.equal((done["byStatus"] as Json)["COMPLETED"], 1);
  });

  it("rejects invalid query parameters", async () => {
    for (const query of [
      "?from=2026-13-01",
      "?from=yesterday",
      "?from=2026-11-10&to=2026-11-01",
      "?granularity=hour",
      "?page=1",
      "?from=1990-01-01&to=2026-01-01&granularity=day",
    ]) {
      const res = await admin.get(`/api/v1/admin/analytics${query}`);
      assert.deepEqual([res.status, res.body.error?.code], [400, "VALIDATION_ERROR"], query);
    }
  });
});

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { createVerifiedCitizen, numbers, startAuthTestApp, type AuthTestContext, type TestClient } from "./helpers/authTestApp.js";
import { setupTestDatabase, skipWithoutDatabase, type TestDatabase } from "./helpers/testDb.js";
import { acceptedReport, createActiveEngineer, reportOf, setupAdmin, submitReport, type Json } from "./helpers/workflowFixtures.js";

describe("assignment and engineer suggestions", { skip: skipWithoutDatabase }, () => {
  let db: TestDatabase;
  let ctx: AuthTestContext;
  let admin: TestClient;
  let citizen: TestClient;

  const assign = (id: string, engineerId: string, reason?: string) =>
    admin.post(`/api/v1/admin/reports/${id}/assignment`, reason === undefined ? { engineerId } : { engineerId, reason });

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
    admin = await setupAdmin(db, ctx);
    citizen = await createVerifiedCitizen(ctx);
  });

  it("assigns an accepted report: attempt 1, PENDING, assignment history, no citizen SMS", async () => {
    const id = await acceptedReport(admin, citizen);
    const { id: engineerId } = await createActiveEngineer(ctx, admin);
    const smsBefore = ctx.sms.messages.length;
    const res = await assign(id, engineerId, "Closest crew");
    assert.equal(res.status, 200, res.text);
    const a = reportOf(res)["assignment"] as Json;
    assert.equal(a["status"], "ASSIGNED");
    assert.equal((a["engineer"] as Json)["id"], engineerId);
    assert.equal(a["repairStatus"], "PENDING");
    assert.equal(a["currentAttempt"], 1);
    const historyRows = reportOf(res)["assignmentHistory"] as Json[];
    assert.equal(historyRows.length, 1);
    assert.equal(historyRows[0]?.["attempt"], 1);
    assert.equal(historyRows[0]?.["reason"], "Closest crew");
    assert.equal(historyRows[0]?.["previousEngineer"], null);
    assert.equal(ctx.sms.messages.length, smsBefore, "no SMS on assignment");
    assert.equal((reportOf(await citizen.get(`/api/v1/reports/${id}`)))["repairProgress"], "SCHEDULED");
    assert.ok(!(await citizen.get(`/api/v1/reports/${id}`)).text.includes("Eng One"), "citizen never sees the engineer");
  });

  it("reassignment starts a new attempt at PENDING and records the previous engineer", async () => {
    const id = await acceptedReport(admin, citizen);
    const { id: first } = await createActiveEngineer(ctx, admin, numbers.engineer, "Eng One");
    const { id: second } = await createActiveEngineer(ctx, admin, numbers.engineer2, "Eng Two");
    await assign(id, first);
    const res = await assign(id, second, "First engineer on leave");
    assert.equal(res.status, 200);
    const a = reportOf(res)["assignment"] as Json;
    assert.deepEqual([(a["engineer"] as Json)["id"], a["repairStatus"], a["currentAttempt"]], [second, "PENDING", 2]);
    const rows = reportOf(res)["assignmentHistory"] as Json[];
    assert.deepEqual(rows.map((r) => [r["attempt"], (r["engineer"] as Json)["id"], (r["previousEngineer"] as Json | null)?.["id"] ?? null]), [
      [1, first, null],
      [2, second, first],
    ]);
    const attempts = reportOf(res)["repairAttempts"] as Json[];
    assert.deepEqual(attempts.map((t) => [t["attempt"], t["isCurrent"], (t["engineer"] as Json)["id"]]), [
      [2, true, second],
      [1, false, first],
    ]);
  });

  it("refuses assignment unless the report is accepted and the engineer is active", async () => {
    const { id: engineerId } = await createActiveEngineer(ctx, admin);
    const submitted = await submitReport(citizen);
    const notAccepted = await assign(submitted, engineerId);
    assert.equal(notAccepted.status, 409);
    assert.equal(notAccepted.body.error?.code, "INVALID_TRANSITION");

    const id = await acceptedReport(admin, citizen);
    const citizenUser = await db.prisma.user.findUniqueOrThrow({ where: { mobileNumber: numbers.citizen } });
    const adminUser = await db.prisma.user.findUniqueOrThrow({ where: { mobileNumber: numbers.admin } });
    for (const wrong of [citizenUser.id, adminUser.id, "00000000-0000-4000-8000-000000000000"]) {
      const res = await assign(id, wrong);
      assert.equal(res.status, 400);
      assert.equal(res.body.error?.code, "ENGINEER_NOT_ASSIGNABLE");
    }
    await admin.patch(`/api/v1/admin/engineers/${engineerId}/status`, { status: "DEACTIVATED" });
    assert.equal((await assign(id, engineerId)).body.error?.code, "ENGINEER_NOT_ASSIGNABLE");
    assert.equal((await assign(id, "not-a-uuid")).status, 400);
    assert.equal(await db.prisma.reportAssignment.count(), 0);
  });

  it("refuses to reassign to the same engineer and handles concurrent assignments", async () => {
    const id = await acceptedReport(admin, citizen);
    const { id: first } = await createActiveEngineer(ctx, admin, numbers.engineer, "Eng One");
    const { id: second } = await createActiveEngineer(ctx, admin, numbers.engineer2, "Eng Two");
    await assign(id, first);
    const same = await assign(id, first);
    assert.equal(same.status, 409);

    const other = await acceptedReport(admin, citizen);
    const results = await Promise.all([assign(other, first), assign(other, second)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    const row = await db.prisma.report.findUniqueOrThrow({ where: { id: other } });
    assert.equal(row.repairAttempt, 1, "only one assignment applied");
    assert.equal(await db.prisma.reportAssignment.count({ where: { reportId: other } }), 1);
  });

  it("suggests active engineers with the fewest open jobs first", async () => {
    const { id: busy } = await createActiveEngineer(ctx, admin, numbers.engineer, "Bilal Busy");
    const { id: free } = await createActiveEngineer(ctx, admin, numbers.engineer2, "Zara Free");
    const inactive = await admin.post("/api/v1/admin/engineers", {
      fullName: "Ahmed Inactive",
      mobileNumber: "+12025550122",
      temporaryPassword: "temporary-pass-123",
    });
    await admin.patch(`/api/v1/admin/engineers/${String((inactive.body.data?.["engineer"] as Json)["id"])}/status`, { status: "DEACTIVATED" });
    await assign(await acceptedReport(admin, citizen), busy);
    await assign(await acceptedReport(admin, citizen), busy);

    const target = await acceptedReport(admin, citizen);
    const res = await admin.get(`/api/v1/admin/reports/${target}/engineer-suggestions`);
    assert.equal(res.status, 200);
    const list = res.body.data?.["engineers"] as Json[];
    assert.deepEqual(list.map((e) => [e["fullName"], e["openJobs"], e["isCurrent"]]), [
      ["Zara Free", 0, false],
      ["Bilal Busy", 2, false],
    ]);
    assert.equal(list.some((e) => e["id"] === free), true);
    assert.equal((await admin.get(`/api/v1/admin/reports/${await submitReport(citizen)}/engineer-suggestions`)).status, 409);
  });

  it("shows engineer workload to admins and lists an engineer's jobs via the report filter", async () => {
    const { id: engineerId } = await createActiveEngineer(ctx, admin);
    const a = await acceptedReport(admin, citizen);
    await assign(a, engineerId);
    const list = await admin.get("/api/v1/admin/engineers");
    const item = (list.body.data?.["items"] as Json[])[0] as Json;
    assert.deepEqual(item["workload"], { openJobs: 1, awaitingConfirmation: 0, completedJobs: 0 });
    const detail = await admin.get(`/api/v1/admin/engineers/${engineerId}`);
    assert.deepEqual((detail.body.data?.["engineer"] as Json)["workload"], { openJobs: 1, awaitingConfirmation: 0, completedJobs: 0 });
    const jobs = await admin.get(`/api/v1/admin/reports?engineerId=${engineerId}`);
    assert.deepEqual((jobs.body.data?.["items"] as Json[]).map((r) => r["id"]), [a]);
    const unassigned = await admin.get("/api/v1/admin/reports?assignment=unassigned&status=ACCEPTED");
    assert.equal(unassigned.body.data?.["total"], 0);
  });
});

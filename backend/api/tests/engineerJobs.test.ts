import assert from "node:assert/strict";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { createVerifiedCitizen, numbers, startAuthTestApp, type AuthTestContext, type TestClient } from "./helpers/authTestApp.js";
import { setupTestDatabase, skipWithoutDatabase, type TestDatabase } from "./helpers/testDb.js";
import { makeJpeg } from "./helpers/testImages.js";
import { acceptedReport, citizenSms, createActiveEngineer, loginAs, reportOf, setupAdmin, type Json } from "./helpers/workflowFixtures.js";

describe("engineer jobs, repair attempts and completion", { skip: skipWithoutDatabase }, () => {
  let db: TestDatabase;
  let ctx: AuthTestContext;
  let admin: TestClient;
  let citizen: TestClient;
  let engineer: TestClient;
  let engineerId: string;

  const job = (id: string) => `/api/v1/engineer/jobs/${id}`;
  const adminReport = (id: string) => `/api/v1/admin/reports/${id}`;
  const jobOf = (res: { body: { data?: Record<string, unknown> } }) => res.body.data?.["job"] as Json;
  const repair = (res: { body: { data?: Record<string, unknown> } }) => jobOf(res)["repair"] as Json;

  async function photo(client: TestClient, id: string, attempt: number) {
    const form = new FormData();
    form.append("expectedAttempt", String(attempt));
    form.append("image", new Blob([new Uint8Array(await makeJpeg(160, 120))], { type: "image/jpeg" }), "repair.jpg");
    return client.postForm(`${job(id)}/photos`, form);
  }
  const setStatus = (client: TestClient, id: string, status: string, expectedAttempt: number, note?: string) =>
    client.patch(`${job(id)}/repair-status`, note === undefined ? { status, expectedAttempt } : { status, expectedAttempt, note });

  /** Accepted report assigned to `engineerId` (attempt 1, PENDING). */
  async function assignedJob(to = engineerId): Promise<string> {
    const id = await acceptedReport(admin, citizen);
    const res = await admin.post(`${adminReport(id)}/assignment`, { engineerId: to });
    assert.equal(res.status, 200, res.text);
    return id;
  }

  /** Engineer finishes attempt `n`: start (if pending), one photo, complete. */
  async function completeAttempt(id: string, n: number, client = engineer): Promise<void> {
    const state = repair(await client.get(job(id)));
    if (state["status"] === "PENDING") assert.equal((await setStatus(client, id, "WORKING", n)).status, 200);
    assert.equal((await photo(client, id, n)).status, 201);
    const done = await setStatus(client, id, "COMPLETED", n);
    assert.equal(done.status, 200, done.text);
  }

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
    for (const area of ["originals", "display"]) {
      for (const name of await readdir(join(ctx.uploadDir, area))) {
        await rm(join(ctx.uploadDir, area, name));
      }
    }
    admin = await setupAdmin(db, ctx);
    citizen = await createVerifiedCitizen(ctx);
    ({ client: engineer, id: engineerId } = await createActiveEngineer(ctx, admin));
  });

  it("runs the full loop with rework: attempt 2 needs its own photos; earlier evidence is kept", async () => {
    const id = await assignedJob();
    const smsStart = citizenSms(ctx, numbers.citizen).length; // the "accepted" SMS

    // Attempt 1
    const opened = await engineer.get(job(id));
    assert.equal(opened.status, 200);
    assert.deepEqual([repair(opened)["status"], repair(opened)["currentAttempt"], repair(opened)["allowedTransitions"]], ["PENDING", 1, ["WORKING"]]);
    assert.ok(!opened.text.includes(numbers.citizen) && !opened.text.includes("Test Citizen"), "engineer never sees the citizen");
    assert.equal((await setStatus(engineer, id, "WORKING", 1, "Crew on site")).status, 200);
    const noPhoto = await setStatus(engineer, id, "COMPLETED", 1);
    assert.equal(noPhoto.status, 409);
    assert.equal(noPhoto.body.error?.code, "REPAIR_PHOTO_REQUIRED");
    assert.equal((await photo(engineer, id, 1)).status, 201);
    assert.equal((await engineer.post(`${job(id)}/notes`, { note: "Filled with asphalt", expectedAttempt: 1 })).status, 200);
    const done1 = await setStatus(engineer, id, "COMPLETED", 1);
    assert.equal(done1.status, 200);
    assert.equal(repair(done1)["canUploadPhotos"], false, "a completed attempt is frozen");
    assert.equal((await photo(engineer, id, 1)).status, 409, "no uploads to a completed attempt");
    assert.equal(reportOf(await citizen.get(`/api/v1/reports/${id}`))["repairProgress"], "AWAITING_CONFIRMATION");
    assert.equal((await admin.get("/api/v1/engineer/summary")).status, 403, "admins cannot use engineer routes");

    // Admin: needs more work (only allowed now), stale attempt refused.
    assert.equal((await admin.post(`${adminReport(id)}/feedback`, { note: "Edges are cracking", expectedAttempt: 2 })).status, 409);
    const fb = await admin.post(`${adminReport(id)}/feedback`, { note: "Edges are cracking", expectedAttempt: 1 });
    assert.equal(fb.status, 200, fb.text);
    assert.equal((reportOf(fb)["assignment"] as Json)["repairStatus"], "COMPLETED", "feedback does not change repair status");
    const summary = (await engineer.get("/api/v1/engineer/summary")).body.data?.["summary"] as Json;
    assert.equal(summary["needsMoreWork"], 1);
    assert.equal((repair(await engineer.get(job(id)))["latestFeedback"] as Json)["note"], "Edges are cracking");

    // Engineer reopens → attempt 2, WORKING, zero photos for this attempt.
    const reopened = await setStatus(engineer, id, "WORKING", 1, "Reopening to fix edges");
    assert.equal(reopened.status, 200, reopened.text);
    assert.deepEqual([repair(reopened)["status"], repair(reopened)["currentAttempt"], repair(reopened)["currentAttemptPhotoCount"]], ["WORKING", 2, 0]);
    const reuse = await setStatus(engineer, id, "COMPLETED", 2);
    assert.equal(reuse.status, 409, "attempt-1 photos do not count for attempt 2");
    assert.equal(reuse.body.error?.code, "REPAIR_PHOTO_REQUIRED");
    assert.equal((await photo(engineer, id, 1)).status, 409, "stale attempt number refused");
    assert.equal((await photo(engineer, id, 2)).status, 201);
    assert.equal((await setStatus(engineer, id, "COMPLETED", 2)).status, 200);

    // Admin sees both attempts with their own evidence, newest first.
    const detail = reportOf(await admin.get(adminReport(id)));
    const attempts = detail["repairAttempts"] as Json[];
    assert.deepEqual(attempts.map((a) => [a["attempt"], a["isCurrent"], (a["photos"] as Json[]).length]), [
      [2, true, 1],
      [1, false, 1],
    ]);
    assert.deepEqual(
      (attempts[1]?.["updates"] as Json[]).map((u) => u["kind"]),
      ["STATUS_CHANGE", "NOTE", "STATUS_CHANGE", "ADMIN_FEEDBACK"],
    );

    // Confirm with the attempt on screen → COMPLETED, one SMS; confirm again refused.
    assert.equal((await admin.post(`${adminReport(id)}/confirm-completion`, { expectedAttempt: 1 })).status, 409, "stale attempt");
    const confirmed = await admin.post(`${adminReport(id)}/confirm-completion`, { expectedAttempt: 2, note: "Looks good" });
    assert.equal(confirmed.status, 200, confirmed.text);
    assert.equal(confirmed.body.data?.["notification"], "sent");
    assert.equal(reportOf(confirmed)["status"], "COMPLETED");
    assert.equal(((reportOf(confirmed)["statusHistory"] as Json[]).at(-1) as Json)["note"], "Repair attempt 2 confirmed. Looks good");
    const sms = citizenSms(ctx, numbers.citizen).slice(smsStart);
    assert.equal(sms.length, 1);
    assert.match(sms[0] ?? "", /has been completed/);
    assert.equal((await admin.post(`${adminReport(id)}/confirm-completion`, { expectedAttempt: 2 })).status, 409);
    assert.equal(reportOf(await citizen.get(`/api/v1/reports/${id}`))["repairProgress"], "DONE");

    // Completed jobs are read-only history for the engineer.
    const history = await engineer.get("/api/v1/engineer/jobs?scope=history");
    assert.deepEqual((history.body.data?.["items"] as Json[]).map((j) => j["id"]), [id]);
    assert.equal((await setStatus(engineer, id, "WORKING", 2)).status, 409);
    assert.equal(await db.prisma.repairPhoto.count({ where: { reportId: id } }), 2, "no evidence deleted");
  });

  it("enforces the feedback rule: only on an accepted report whose repair is completed", async () => {
    const id = await assignedJob();
    const feedback = () => admin.post(`${adminReport(id)}/feedback`, { note: "More work", expectedAttempt: 1 });
    assert.equal((await feedback()).body.error?.code, "INVALID_TRANSITION", "PENDING");
    await setStatus(engineer, id, "WORKING", 1);
    assert.equal((await feedback()).body.error?.code, "INVALID_TRANSITION", "WORKING");
    await photo(engineer, id, 1);
    await setStatus(engineer, id, "COMPLETED", 1);
    assert.equal((await feedback()).status, 200, "COMPLETED: allowed");
    assert.equal(await db.prisma.repairUpdate.count({ where: { kind: "ADMIN_FEEDBACK" } }), 1);
    await admin.post(`${adminReport(id)}/confirm-completion`, { expectedAttempt: 1 });
    assert.equal((await feedback()).body.error?.code, "INVALID_TRANSITION", "after confirmation");
    assert.equal((await admin.post(`${adminReport(id)}/feedback`, { note: "", expectedAttempt: 1 })).status, 400);
  });

  it("caps photos per attempt (5), not per job, and never exceeds the cap with parallel uploads", async () => {
    const id = await assignedJob();
    await setStatus(engineer, id, "WORKING", 1);
    for (let i = 0; i < 3; i += 1) assert.equal((await photo(engineer, id, 1)).status, 201);
    const parallel = await Promise.all([photo(engineer, id, 1), photo(engineer, id, 1), photo(engineer, id, 1)]);
    assert.deepEqual(parallel.map((r) => r.status).sort(), [201, 201, 409]);
    assert.equal(parallel.find((r) => r.status === 409)?.body.error?.code, "REPAIR_PHOTO_LIMIT");
    assert.equal(await db.prisma.repairPhoto.count({ where: { reportId: id, attempt: 1 } }), 5);

    await setStatus(engineer, id, "COMPLETED", 1);
    await admin.post(`${adminReport(id)}/feedback`, { note: "Redo", expectedAttempt: 1 });
    await setStatus(engineer, id, "WORKING", 1);
    for (let i = 0; i < 5; i += 1) assert.equal((await photo(engineer, id, 2)).status, 201, "5 more in attempt 2");
    assert.equal((await photo(engineer, id, 2)).body.error?.code, "REPAIR_PHOTO_LIMIT");
    assert.equal(await db.prisma.repairPhoto.count({ where: { reportId: id } }), 10);
    // Rejected uploads leave no files behind: 10 repair photos + 1 report photo, each original + display.
    assert.equal((await readdir(join(ctx.uploadDir, "display"))).length, 11);
    assert.equal((await readdir(join(ctx.uploadDir, "originals"))).length, 11);
  });

  it("reassignment starts a fresh attempt; the new engineer needs their own photos; the old one loses access", async () => {
    const id = await assignedJob();
    await completeAttempt(id, 1);
    const view1 = jobOf(await engineer.get(job(id)));
    const attempt1 = (view1["attempts"] as Json[])[0] as Json;
    const oldPhotoUrl = String(((attempt1["photos"] as Json[])[0] as Json)["url"]);
    const reportImageUrl = String((view1["image"] as Json)["url"]);
    assert.equal((await engineer.getRaw(reportImageUrl)).status, 200, "assigned engineer can see the report photo");
    assert.equal((await engineer.getRaw(oldPhotoUrl)).status, 200);

    const { client: second, id: secondId } = await createActiveEngineer(ctx, admin, numbers.engineer2, "Eng Two");
    const reassigned = await admin.post(`${adminReport(id)}/assignment`, { engineerId: secondId, reason: "Original crew unavailable" });
    assert.equal(reassigned.status, 200);
    const a = reportOf(reassigned)["assignment"] as Json;
    assert.deepEqual([a["repairStatus"], a["currentAttempt"]], ["PENDING", 2]);

    const view = await second.get(job(id));
    assert.deepEqual([repair(view)["currentAttempt"], repair(view)["currentAttemptPhotoCount"]], [2, 0]);
    assert.equal((await setStatus(second, id, "WORKING", 2)).status, 200);
    assert.equal((await setStatus(second, id, "COMPLETED", 2)).body.error?.code, "REPAIR_PHOTO_REQUIRED");
    assert.equal((await second.getRaw(oldPhotoUrl)).status, 200, "the current engineer may view earlier evidence of the job");

    // Old engineer: job gone, photos gone, actions refused.
    assert.equal((await engineer.get(job(id))).status, 404);
    assert.equal((await engineer.getRaw(oldPhotoUrl)).status, 404);
    assert.equal((await engineer.getRaw(reportImageUrl)).status, 404);
    assert.equal((await photo(engineer, id, 2)).status, 404);
    // Admin still sees attempt 1 evidence attributed to the first engineer.
    const attempts = reportOf(await admin.get(adminReport(id)))["repairAttempts"] as Json[];
    const first = attempts.find((t) => t["attempt"] === 1) as Json;
    assert.equal((first["engineer"] as Json)["id"], engineerId);
    assert.equal(((first["photos"] as Json[])[0]?.["uploadedBy"] as Json)["id"], engineerId);
    assert.equal((await admin.getRaw(oldPhotoUrl)).status, 200);
  });

  it("keeps engineers to their own jobs and rejects invalid requests", async () => {
    const mine = await assignedJob();
    const { client: other } = await createActiveEngineer(ctx, admin, numbers.engineer2, "Eng Two");
    assert.equal((await other.get(job(mine))).status, 404);
    assert.equal((await setStatus(other, mine, "WORKING", 1)).status, 404);
    assert.equal((await other.post(`${job(mine)}/notes`, { note: "x", expectedAttempt: 1 })).status, 404);
    assert.equal((await photo(other, mine, 1)).status, 404);
    assert.deepEqual(((await other.get("/api/v1/engineer/jobs")).body.data?.["items"] as Json[]), []);
    assert.equal((await citizen.get("/api/v1/engineer/jobs")).status, 403);
    assert.equal((await ctx.client().get("/api/v1/engineer/jobs")).status, 401);
    assert.equal((await citizen.getRaw(`/api/v1/reports/${mine}/repair-photos/00000000-0000-4000-8000-000000000000`)).status, 403);

    // Validation: PENDING can never be requested; attempt is required; no skipping Working.
    assert.equal((await setStatus(engineer, mine, "PENDING", 1)).status, 400);
    assert.equal((await engineer.patch(`${job(mine)}/repair-status`, { status: "WORKING" })).status, 400);
    assert.equal((await setStatus(engineer, mine, "COMPLETED", 1)).body.error?.code, "INVALID_TRANSITION");
    assert.equal((await setStatus(engineer, mine, "WORKING", 5)).body.error?.code, "REPORT_STATE_CONFLICT");
    const form = new FormData();
    form.append("expectedAttempt", "1");
    form.append("image", new Blob([new TextEncoder().encode("not an image")], { type: "image/jpeg" }), "x.jpg");
    assert.equal((await engineer.postForm(`${job(mine)}/photos`, form)).status, 415);

    // An engineer with a temporary password must change it first.
    await admin.post("/api/v1/admin/engineers", { fullName: "New Eng", mobileNumber: "+12025550123", temporaryPassword: "temporary-pass-123" });
    const fresh = await loginAs(ctx, "+12025550123", "temporary-pass-123");
    const blocked = await fresh.get("/api/v1/engineer/jobs");
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error?.code, "PASSWORD_CHANGE_REQUIRED");
  });

  it("lists active jobs with feedback flags and refuses actions after reassignment races", async () => {
    const id = await assignedJob();
    const list = await engineer.get("/api/v1/engineer/jobs");
    const item = (list.body.data?.["items"] as Json[])[0] as Json;
    assert.deepEqual([item["id"], item["repairStatus"], item["currentAttempt"], item["needsMoreWork"]], [id, "PENDING", 1, false]);

    // Engineer's screen still shows attempt 1 while the admin reassigns to someone else and back.
    const { id: secondId } = await createActiveEngineer(ctx, admin, numbers.engineer2, "Eng Two");
    await admin.post(`${adminReport(id)}/assignment`, { engineerId: secondId });
    await admin.post(`${adminReport(id)}/assignment`, { engineerId });
    const stale = await setStatus(engineer, id, "WORKING", 1);
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error?.code, "REPORT_STATE_CONFLICT");
    assert.equal(repair(await engineer.get(job(id)))["currentAttempt"], 3);
  });

  it("never sends engineers the citizen's identity or EXIF data, and keeps history photos visible to them", async () => {
    const id = await assignedJob();
    const res = await engineer.get(job(id));
    for (const hidden of [numbers.citizen, "Test Citizen", "citizen", "exif", "Exif"]) {
      assert.ok(!res.text.includes(hidden), `${hidden} must not be sent to engineers`);
    }
    await completeAttempt(id, 1);
    const view = jobOf(await engineer.get(job(id)));
    const photoUrl = String((((view["attempts"] as Json[])[0] as Json)["photos"] as Json[])[0]?.["url"]);
    const imageUrl = String((view["image"] as Json)["url"]);
    assert.equal((await admin.post(`${adminReport(id)}/confirm-completion`, { expectedAttempt: 1 })).status, 200);
    // Completed jobs stay in the engineer's history with their photos.
    assert.equal((await engineer.get(job(id))).status, 200);
    assert.equal((await engineer.getRaw(imageUrl)).status, 200);
    assert.equal((await engineer.getRaw(photoUrl)).status, 200);
  });

  it("lets exactly one of a simultaneous admin confirmation and engineer reopen win", async () => {
    for (let round = 0; round < 3; round += 1) {
      const id = await assignedJob();
      await completeAttempt(id, 1);
      const [confirm, reopen] = await Promise.all([
        admin.post(`${adminReport(id)}/confirm-completion`, { expectedAttempt: 1 }),
        setStatus(engineer, id, "WORKING", 1),
      ]);
      assert.deepEqual([confirm.status, reopen.status].sort(), [200, 409], `round ${round}`);
      const row = await db.prisma.report.findUniqueOrThrow({ where: { id } });
      if (confirm.status === 200) {
        assert.deepEqual([row.status, row.repairStatus, row.repairAttempt], ["COMPLETED", "COMPLETED", 1]);
      } else {
        assert.deepEqual([row.status, row.repairStatus, row.repairAttempt], ["ACCEPTED", "WORKING", 2]);
      }
    }
  });

  it("flags jobs held by a deactivated engineer and lets the admin reassign them", async () => {
    const id = await assignedJob();
    await setStatus(engineer, id, "WORKING", 1);
    assert.equal((await admin.patch(`/api/v1/admin/engineers/${engineerId}/status`, { status: "DEACTIVATED" })).status, 200);
    assert.equal((await engineer.get(job(id))).status, 401, "deactivated engineer is logged out");
    const dashboard = (await admin.get("/api/v1/admin/dashboard")).body.data?.["dashboard"] as Json;
    assert.equal((dashboard["queues"] as Json)["jobsOnDeactivatedEngineers"], 1);
    const detail = reportOf(await admin.get(adminReport(id)));
    assert.equal(((detail["assignment"] as Json)["engineer"] as Json)["status"], "DEACTIVATED");

    const { client: second, id: secondId } = await createActiveEngineer(ctx, admin, numbers.engineer2, "Eng Two");
    const reassigned = await admin.post(`${adminReport(id)}/assignment`, { engineerId: secondId, reason: "Engineer left" });
    assert.equal(reassigned.status, 200);
    assert.equal(repair(await second.get(job(id)))["currentAttempt"], 2);
    const after = (await admin.get("/api/v1/admin/dashboard")).body.data?.["dashboard"] as Json;
    assert.equal((after["queues"] as Json)["jobsOnDeactivatedEngineers"], 0);
  });
});

describe("repair photo upload rate limit", { skip: skipWithoutDatabase }, () => {
  let db: TestDatabase;
  let ctx: AuthTestContext;

  before(async () => {
    db = setupTestDatabase();
    ctx = await startAuthTestApp(db.prisma, { rateLimiting: true });
  });
  after(async () => {
    await ctx.close();
    await db.close();
  });

  it("allows 30 upload requests per hour per engineer, then answers 429 before reading the upload", async () => {
    await db.reset();
    const admin = await setupAdmin(db, ctx);
    const citizen = await createVerifiedCitizen(ctx);
    const { client: engineer, id: engineerId } = await createActiveEngineer(ctx, admin);
    const id = await acceptedReport(admin, citizen);
    await admin.post(`/api/v1/admin/reports/${id}/assignment`, { engineerId });
    const empty = () => {
      // Missing photo: rejected by the handler (400), but every request counts towards the limit.
      const form = new FormData();
      form.append("expectedAttempt", "1");
      return engineer.postForm(`/api/v1/engineer/jobs/${id}/photos`, form);
    };
    for (let i = 0; i < 30; i += 1) {
      assert.equal((await empty()).status, 400, `request ${i + 1}`);
    }
    const blocked = await empty();
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error?.code, "TOO_MANY_REQUESTS");
    // Per engineer, not per IP: another engineer is unaffected.
    const { client: other } = await createActiveEngineer(ctx, admin, numbers.engineer2, "Eng Two");
    const form = new FormData();
    form.append("expectedAttempt", "1");
    assert.equal((await other.postForm(`/api/v1/engineer/jobs/${id}/photos`, form)).status, 400, "not rate limited (it fails later, as expected)");
  });
});

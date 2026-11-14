import assert from "node:assert/strict";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import sharp from "sharp";
import { AiServiceError } from "../src/services/ai/aiClient.js";
import { createAdminAccount } from "../src/services/adminBootstrap.service.js";
import { readExifGps } from "../src/services/location/exifGps.js";
import {
  createVerifiedCitizen,
  numbers,
  PASSWORD,
  startAuthTestApp,
  type AuthTestContext,
  type TestClient,
  type TestResponse,
} from "./helpers/authTestApp.js";
import { detection } from "./helpers/fakeAi.js";
import { makeJpeg, makeJpegWithGps, makePng } from "./helpers/testImages.js";
import { setupTestDatabase, skipWithoutDatabase, type TestDatabase } from "./helpers/testDb.js";

/** Selected location used by most tests (Westminster, London). */
const HERE = { latitude: 51.5007, longitude: -0.1246 };

type Fields = Record<string, string>;
type Json = Record<string, unknown>;

function reportForm(image: Buffer | undefined, fields: Fields, file: { name?: string; type?: string; field?: string } = {}): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value);
  }
  if (image !== undefined) {
    form.append(file.field ?? "image", new Blob([new Uint8Array(image)], { type: file.type ?? "image/jpeg" }), file.name ?? "photo.jpg");
  }
  return form;
}

const galleryFields = (extra: Fields = {}): Fields => ({
  captureMethod: "GALLERY_UPLOAD",
  latitude: String(HERE.latitude),
  longitude: String(HERE.longitude),
  ...extra,
});

const liveFields = (accuracy: string, extra: Fields = {}): Fields => ({
  captureMethod: "LIVE_CAMERA",
  latitude: String(HERE.latitude),
  longitude: String(HERE.longitude),
  gpsAccuracyMeters: accuracy,
  ...extra,
});

const reportOf = (res: TestResponse): Json => res.body.data?.["report"] as Json;

describe("citizen reports", { skip: skipWithoutDatabase }, () => {
  let db: TestDatabase;
  let ctx: AuthTestContext;
  let citizen: TestClient;

  async function submit(client: TestClient, image: Buffer | undefined, fields: Fields, file?: Parameters<typeof reportForm>[2]): Promise<TestResponse> {
    return client.postForm("/api/v1/reports", reportForm(image, fields, file));
  }

  async function submitOk(fields: Fields = galleryFields(), image?: Buffer): Promise<Json> {
    const res = await submit(citizen, image ?? (await makeJpeg()), fields);
    assert.equal(res.status, 201, res.text);
    return reportOf(res);
  }

  async function loginAs(mobileNumber: string, password: string): Promise<TestClient> {
    const client = ctx.client();
    const res = await client.post("/api/v1/auth/login", { mobileNumber, password });
    assert.equal(res.status, 200, `login ${mobileNumber}`);
    return client;
  }

  async function adminClient(): Promise<TestClient> {
    await createAdminAccount(db.prisma, { fullName: "Admin One", mobileNumber: numbers.admin, password: PASSWORD }, { allowAdditional: false });
    return loginAs(numbers.admin, PASSWORD);
  }

  async function engineerClient(admin: TestClient): Promise<TestClient> {
    const created = await admin.post("/api/v1/admin/engineers", {
      fullName: "Eng One",
      mobileNumber: numbers.engineer,
      temporaryPassword: "temporary-pass-123",
    });
    assert.equal(created.status, 201);
    const engineer = await loginAs(numbers.engineer, "temporary-pass-123");
    const changed = await engineer.post("/api/v1/profile/password", {
      currentPassword: "temporary-pass-123",
      newPassword: "engineer-own-password",
      confirmNewPassword: "engineer-own-password",
    });
    assert.equal(changed.status, 200);
    return engineer;
  }

  async function storedFiles(): Promise<{ originals: string[]; display: string[] }> {
    return {
      originals: await readdir(join(ctx.uploadDir, "originals")),
      display: await readdir(join(ctx.uploadDir, "display")),
    };
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
    ctx.ai.reset();
    for (const area of ["originals", "display"]) {
      for (const name of await readdir(join(ctx.uploadDir, area))) {
        await rm(join(ctx.uploadDir, area, name));
      }
    }
    citizen = await createVerifiedCitizen(ctx);
  });

  describe("authentication, roles and CSRF", () => {
    it("requires a logged-in user", async () => {
      const anonymous = ctx.client();
      assert.equal((await anonymous.get("/api/v1/reports")).status, 401);
      assert.equal((await submit(anonymous, await makeJpeg(), galleryFields())).status, 401);
      assert.equal(ctx.ai.calls.length, 0);
    });

    it("lets only citizens submit and list reports", async () => {
      const admin = await adminClient();
      const engineer = await engineerClient(admin);
      for (const client of [admin, engineer]) {
        const res = await submit(client, await makeJpeg(), galleryFields());
        assert.equal(res.status, 403);
        assert.equal(res.body.error?.code, "FORBIDDEN");
        assert.equal((await client.get("/api/v1/reports")).status, 403);
      }
      assert.equal(await db.prisma.report.count(), 0);
      assert.equal(ctx.ai.calls.length, 0);
    });

    it("requires the CSRF token for submissions", async () => {
      const res = await citizen.postForm("/api/v1/reports", reportForm(await makeJpeg(), galleryFields()), { csrf: false });
      assert.equal(res.status, 403);
      assert.equal(res.body.error?.code, "CSRF_TOKEN_INVALID");
      assert.equal(await db.prisma.report.count(), 0);
    });
  });

  describe("submission validation", () => {
    it("requires a photo", async () => {
      const res = await submit(citizen, undefined, galleryFields());
      assert.equal(res.status, 400);
      assert.equal(res.body.error?.code, "IMAGE_REQUIRED");
    });

    it("rejects files that are not really JPEG or PNG, whatever their name or MIME type", async () => {
      for (const content of [Buffer.from("plain text pretending to be a photo"), Buffer.from("GIF89a\x01\x00\x01\x00")]) {
        const res = await submit(citizen, content, galleryFields(), { name: "road.jpg", type: "image/jpeg" });
        assert.equal(res.status, 415);
        assert.equal(res.body.error?.code, "UNSUPPORTED_IMAGE_TYPE");
      }
      assert.equal(await db.prisma.report.count(), 0);
      assert.equal(ctx.ai.calls.length, 0);
    });

    it("rejects corrupt images", async () => {
      const corrupt = (await makeJpeg()).subarray(0, 60);
      const res = await submit(citizen, corrupt, galleryFields());
      assert.equal(res.status, 400);
      assert.equal(res.body.error?.code, "IMAGE_INVALID");
    });

    it("rejects files over 10 MB", async () => {
      const big = Buffer.concat([await makeJpeg(), Buffer.alloc(10 * 1024 * 1024)]);
      const res = await submit(citizen, big, galleryFields());
      assert.equal(res.status, 413);
      assert.equal(res.body.error?.code, "FILE_TOO_LARGE");
      assert.deepEqual(await storedFiles(), { originals: [], display: [] });
    });

    it("accepts only one file in the image field", async () => {
      const form = reportForm(await makeJpeg(), galleryFields());
      form.append("image", new Blob([new Uint8Array(await makeJpeg())], { type: "image/jpeg" }), "second.jpg");
      const twoFiles = await citizen.postForm("/api/v1/reports", form);
      assert.equal(twoFiles.status, 400);
      assert.equal(twoFiles.body.error?.code, "UNEXPECTED_FIELD");

      const wrongField = await submit(citizen, await makeJpeg(), galleryFields(), { field: "photo" });
      assert.equal(wrongField.status, 400);
      assert.equal(wrongField.body.error?.code, "UNEXPECTED_FIELD");
    });

    it("requires multipart/form-data", async () => {
      const res = await citizen.post("/api/v1/reports", galleryFields());
      assert.equal(res.status, 400);
      assert.equal(res.body.error?.code, "MULTIPART_REQUIRED");
    });

    it("validates the fields", async () => {
      const cases: Fields[] = [
        galleryFields({ latitude: "91" }),
        galleryFields({ longitude: "-181" }),
        galleryFields({ latitude: "" }),
        galleryFields({ latitude: "12abc" }),
        { ...galleryFields(), captureMethod: "DRONE" },
        galleryFields({ gpsAccuracyMeters: "10" }),
        liveFields("10", { description: "x".repeat(1001) }),
        galleryFields({ unexpected: "field" }),
      ];
      const { latitude: _omitted, ...withoutLatitude } = galleryFields();
      cases.push(withoutLatitude);
      for (const fields of cases) {
        const res = await submit(citizen, await makeJpeg(), fields);
        assert.equal(res.status, 400, JSON.stringify(fields).slice(0, 80));
        assert.equal(res.body.error?.code, "VALIDATION_ERROR");
      }
      const { gpsAccuracyMeters: _accuracy, ...liveWithoutAccuracy } = liveFields("10");
      const res = await submit(citizen, await makeJpeg(), liveWithoutAccuracy);
      assert.equal(res.status, 400);
      assert.ok((res.body.error?.details?.["fields"] as Json)["gpsAccuracyMeters"]);
      assert.equal(await db.prisma.report.count(), 0);
    });
  });

  describe("location verification", () => {
    it("marks a gallery photo VERIFIED when its EXIF GPS is within 2 km", async () => {
      const report = await submitOk(galleryFields(), await makeJpegWithGps(51.51, -0.12));
      const location = report["location"] as Json;
      assert.equal(location["verificationStatus"], "VERIFIED");
      assert.equal(location["needsReview"], false);
      assert.ok(Number(location["exifDistanceMeters"]) < 2000);
      const row = await db.prisma.report.findUniqueOrThrow({ where: { id: String(report["id"]) } });
      assert.ok(row.exifLatitude !== null && Math.abs(row.exifLatitude - 51.51) < 1e-4);
    });

    it("flags a gallery photo as MISMATCH when its EXIF GPS is further away (not rejected)", async () => {
      const report = await submitOk(galleryFields(), await makeJpegWithGps(48.8566, 2.3522));
      const location = report["location"] as Json;
      assert.equal(location["verificationStatus"], "MISMATCH");
      assert.equal(location["needsReview"], true);
      assert.equal(report["status"], "SUBMITTED");
    });

    it("flags a gallery photo without EXIF GPS as NO_METADATA", async () => {
      const report = await submitOk(galleryFields(), await makeJpeg());
      assert.deepEqual(
        { status: (report["location"] as Json)["verificationStatus"], review: (report["location"] as Json)["needsReview"] },
        { status: "NO_METADATA", review: true },
      );
    });

    it("uses BROWSER_GPS for live camera and flags only poor accuracy", async () => {
      const good = await submitOk(liveFields("25"));
      assert.deepEqual(
        { s: (good["location"] as Json)["verificationStatus"], r: (good["location"] as Json)["needsReview"], a: (good["location"] as Json)["gpsAccuracyMeters"] },
        { s: "BROWSER_GPS", r: false, a: 25 },
      );
      // A live photo with EXIF GPS somewhere else is still not compared (no EXIF check for live camera).
      const poor = await submitOk(liveFields("350"), await makeJpegWithGps(48.8566, 2.3522));
      assert.equal((poor["location"] as Json)["verificationStatus"], "BROWSER_GPS");
      assert.equal((poor["location"] as Json)["needsReview"], true);
      assert.equal((poor["location"] as Json)["gpsAccuracyMeters"], 350);
    });
  });

  describe("AI analysis and estimated severity", () => {
    it("stores the AI detections and the estimated severity", async () => {
      // 200x100 image; box 100x50 = 25% of the image; 0.25 × 0.9 × 1.0 = 0.225 → HIGH
      ctx.ai.detections = [detection("pothole", 0.9, [0, 0, 100, 50]), detection("transverse_crack", 0.4, [120, 10, 180, 30])];
      const report = await submitOk();
      const analysis = report["analysis"] as Json;
      assert.equal(analysis["status"], "COMPLETED");
      assert.equal(analysis["estimatedSeverity"], "HIGH");
      assert.equal(analysis["model"], "best");
      const detections = analysis["detections"] as Json[];
      assert.equal(detections.length, 2);
      assert.deepEqual(
        detections.map((d) => [d["className"], d["confidence"], d["areaFraction"]]),
        [
          ["pothole", 0.9, 0.25],
          ["transverse_crack", 0.4, 0.06],
        ],
      );
      assert.deepEqual(detections[0]?.["box"], { x1: 0, y1: 0, x2: 100, y2: 50 });

      const rows = await db.prisma.aiDetection.findMany({ where: { reportId: String(report["id"]) } });
      assert.equal(rows.length, 2);
      const stored = await db.prisma.report.findUniqueOrThrow({ where: { id: String(report["id"]) } });
      assert.equal(stored.aiSeverity, "HIGH");
      assert.equal(stored.adminSeverity, null);
    });

    it("keeps a completed analysis with no detections without a severity", async () => {
      const report = await submitOk();
      const analysis = report["analysis"] as Json;
      assert.equal(analysis["status"], "COMPLETED");
      assert.equal(analysis["estimatedSeverity"], null);
      assert.deepEqual(analysis["detections"], []);
    });

    for (const kind of ["unavailable", "timeout", "invalid_response", "rejected"] as const) {
      it(`still saves the report when the AI service fails (${kind}), without any fake result`, async () => {
        ctx.ai.failWith = new AiServiceError(kind, "simulated");
        const report = await submitOk();
        const analysis = report["analysis"] as Json;
        assert.equal(analysis["status"], "FAILED");
        assert.equal(analysis["estimatedSeverity"], null);
        assert.deepEqual(analysis["detections"], []);
        assert.equal(report["status"], "SUBMITTED");
        const stored = await db.prisma.report.findUniqueOrThrow({ where: { id: String(report["id"]) } });
        assert.equal(stored.aiErrorCode, kind);
        assert.equal(stored.aiModel, null);
      });
    }

    it("treats an answer for a differently sized image as invalid", async () => {
      ctx.ai.detections = [detection("pothole", 0.9, [0, 0, 100, 50])];
      ctx.ai.reportedSize = { width: 999, height: 999 };
      const report = await submitOk();
      assert.equal((report["analysis"] as Json)["status"], "FAILED");
      assert.equal(await db.prisma.aiDetection.count(), 0);
    });
  });

  describe("secure image handling", () => {
    it("stores the original privately, sends only a metadata-free copy to the AI service and to users", async () => {
      const original = await makeJpegWithGps(51.51, -0.12, 300, 150);
      const report = await submitOk(galleryFields(), original);
      const files = await storedFiles();
      assert.equal(files.originals.length, 1);
      assert.equal(files.display.length, 1);
      // Server-generated names; the client's "photo.jpg" is never used.
      assert.match(files.originals[0] ?? "", /^[0-9a-f-]{36}\.jpg$/);
      assert.match(files.display[0] ?? "", /^[0-9a-f-]{36}\.jpg$/);

      const storedOriginal = await readFile(join(ctx.uploadDir, "originals", files.originals[0] ?? ""));
      assert.ok(storedOriginal.equals(original), "original is kept byte for byte");
      assert.notEqual(await readExifGps(storedOriginal), null);

      assert.equal(ctx.ai.calls.length, 1);
      assert.equal(await readExifGps(ctx.ai.calls[0]?.image ?? Buffer.alloc(0)), null, "AI service never receives GPS metadata");

      const image = report["image"] as Json;
      assert.deepEqual([image["width"], image["height"]], [300, 150]);
      const res = await citizen.getRaw(String(image["url"]));
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "image/jpeg");
      assert.equal(res.headers.get("cache-control"), "private, no-store");
      const served = Buffer.from(await res.arrayBuffer());
      assert.equal(await readExifGps(served), null);
      assert.equal((await sharp(served).metadata()).exif, undefined);
    });

    it("converts PNG uploads to a JPEG display copy", async () => {
      const report = await submitOk(galleryFields(), await makePng());
      const res = await citizen.getRaw(String((report["image"] as Json)["url"]));
      assert.equal((await sharp(Buffer.from(await res.arrayBuffer())).metadata()).format, "jpeg");
      const stored = await db.prisma.reportImage.findFirstOrThrow();
      assert.equal(stored.mimeType, "image/png");
    });

    it("never exposes storage keys, EXIF coordinates or admin fields", async () => {
      await submitOk(galleryFields(), await makeJpegWithGps(51.51, -0.12));
      const responses = [await citizen.get("/api/v1/reports"), await citizen.get("/api/v1/reports/summary")];
      const id = String(((responses[0]?.body.data?.["items"] as Json[])[0] ?? {})["id"]);
      responses.push(await citizen.get(`/api/v1/reports/${id}`));
      for (const res of responses) {
        for (const secret of ["originals/", "display/", "Key", "exifLatitude", "exifLongitude", "adminSeverity", "sha256", "51.51"]) {
          assert.ok(!res.text.includes(secret), `${secret} leaked`);
        }
      }
    });

    it("serves images only to the owner and to admins", async () => {
      const report = await submitOk();
      const url = String((report["image"] as Json)["url"]);

      assert.equal((await ctx.client().getRaw(url)).status, 401);
      const other = await createVerifiedCitizen(ctx, numbers.citizen2);
      assert.equal((await other.getRaw(url)).status, 404);
      const admin = await adminClient();
      assert.equal((await admin.getRaw(url)).status, 200);
      const engineer = await engineerClient(admin);
      assert.equal((await engineer.getRaw(url)).status, 403);

      const wrongImage = url.replace(/[0-9a-f-]{36}$/, "00000000-0000-4000-8000-000000000000");
      assert.equal((await citizen.getRaw(wrongImage)).status, 404);
      assert.equal((await citizen.getRaw(url.replace(/images\/.*/, "images/not-a-uuid"))).status, 400);
    });

    it("deletes stored files when the report cannot be saved", async () => {
      // A citizen id that does not exist makes the database insert fail (foreign key).
      await assert.rejects(
        ctx.services.reports.create("00000000-0000-4000-8000-000000000000", { captureMethod: "GALLERY_UPLOAD", ...HERE }, await makeJpeg()),
      );
      assert.deepEqual(await storedFiles(), { originals: [], display: [] });
      assert.equal(await db.prisma.report.count(), 0);
    });
  });

  describe("citizen dashboard data", () => {
    it("shows a citizen only their own reports, with details and a status audit entry", async () => {
      const mine = await submitOk(galleryFields({ description: "  Deep pothole near the bus stop  " }));
      assert.equal(mine["description"], "Deep pothole near the bus stop");
      const other = await createVerifiedCitizen(ctx, numbers.citizen2);
      const theirs = reportOf(await submit(other, await makeJpeg(), galleryFields()));

      const list = await citizen.get("/api/v1/reports");
      assert.equal(list.status, 200);
      assert.deepEqual((list.body.data?.["items"] as Json[]).map((r) => r["id"]), [mine["id"]]);

      assert.equal((await citizen.get(`/api/v1/reports/${String(mine["id"])}`)).status, 200);
      const forbidden = await citizen.get(`/api/v1/reports/${String(theirs["id"])}`);
      assert.equal(forbidden.status, 404);
      assert.equal(forbidden.body.error?.code, "REPORT_NOT_FOUND");
      assert.equal((await citizen.get("/api/v1/reports/not-a-uuid")).status, 400);

      const history = await db.prisma.reportStatusHistory.findMany({ where: { reportId: String(mine["id"]) } });
      assert.equal(history.length, 1);
      assert.deepEqual([history[0]?.fromStatus, history[0]?.toStatus], [null, "SUBMITTED"]);
    });

    it("paginates, sorts and filters the list and summarises statuses", async () => {
      ctx.ai.detections = [detection("pothole", 0.9, [0, 0, 100, 50])];
      const ids: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        ids.push(String((await submitOk())["id"]));
      }
      const page1 = await citizen.get("/api/v1/reports?pageSize=2&page=1");
      const data = page1.body.data as Json;
      assert.equal(data["total"], 3);
      assert.deepEqual((data["items"] as Json[]).map((r) => r["id"]), [ids[2], ids[1]]);
      const item = (data["items"] as Json[])[0] as Json;
      assert.deepEqual(item["analysis"], { status: "COMPLETED", estimatedSeverity: "HIGH", detectionCount: 1, damageClasses: ["pothole"] });

      const oldest = await citizen.get("/api/v1/reports?sort=oldest&pageSize=1");
      assert.deepEqual(((oldest.body.data as Json)["items"] as Json[]).map((r) => r["id"]), [ids[0]]);

      await db.prisma.report.update({ where: { id: ids[0] ?? "" }, data: { status: "ACCEPTED" } });
      const accepted = await citizen.get("/api/v1/reports?status=ACCEPTED");
      assert.deepEqual(((accepted.body.data as Json)["items"] as Json[]).map((r) => r["id"]), [ids[0]]);

      const summary = (await citizen.get("/api/v1/reports/summary")).body.data?.["summary"] as Json;
      assert.equal(summary["total"], 3);
      assert.deepEqual(summary["byStatus"], { SUBMITTED: 2, UNDER_REVIEW: 0, ACCEPTED: 1, REJECTED: 0, DELAYED: 0, COMPLETED: 0 });

      for (const query of ["status=OPEN", "pageSize=51", "page=0", "sort=random", "extra=1"]) {
        assert.equal((await citizen.get(`/api/v1/reports?${query}`)).status, 400, query);
      }
    });
  });
});

describe("report submission rate limit", { skip: skipWithoutDatabase }, () => {
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

  it("allows 10 reports per hour per citizen, then answers 429", async () => {
    await db.reset();
    const citizen = await createVerifiedCitizen(ctx);
    const image = await makeJpeg();
    for (let i = 0; i < 10; i += 1) {
      const res = await citizen.postForm("/api/v1/reports", reportForm(image, galleryFields()));
      assert.equal(res.status, 201, `report ${i + 1}`);
    }
    const blocked = await citizen.postForm("/api/v1/reports", reportForm(image, galleryFields()));
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error?.code, "TOO_MANY_REQUESTS");
    assert.equal(await db.prisma.report.count(), 10);

    // The limit is per citizen, not per IP: another citizen on the same address can still report.
    const other = await createVerifiedCitizen(ctx, numbers.citizen2);
    assert.equal((await other.postForm("/api/v1/reports", reportForm(image, galleryFields()))).status, 201);
  });
});

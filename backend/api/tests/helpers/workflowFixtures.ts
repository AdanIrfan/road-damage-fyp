import assert from "node:assert/strict";
import { createAdminAccount } from "../../src/services/adminBootstrap.service.js";
import { numbers, PASSWORD, type AuthTestContext, type TestClient, type TestResponse } from "./authTestApp.js";
import type { TestDatabase } from "./testDb.js";
import { makeJpeg } from "./testImages.js";

export type Json = Record<string, unknown>;

export const ENGINEER_PASSWORD = "engineer-own-password";

export async function loginAs(ctx: AuthTestContext, mobileNumber: string, password: string): Promise<TestClient> {
  const client = ctx.client();
  const res = await client.post("/api/v1/auth/login", { mobileNumber, password });
  assert.equal(res.status, 200, `login ${mobileNumber}: ${res.text}`);
  return client;
}

/** Creates the first admin (or an additional one) and returns a logged-in client. */
export async function setupAdmin(db: TestDatabase, ctx: AuthTestContext, mobileNumber = numbers.admin): Promise<TestClient> {
  const existing = await db.prisma.user.count({ where: { role: "ADMIN" } });
  await createAdminAccount(
    db.prisma,
    { fullName: `Admin ${mobileNumber.slice(-3)}`, mobileNumber, password: PASSWORD },
    { allowAdditional: existing > 0 },
  );
  return loginAs(ctx, mobileNumber, PASSWORD);
}

/** Admin creates an engineer; the engineer replaces the temporary password and is returned logged in. */
export async function createActiveEngineer(
  ctx: AuthTestContext,
  admin: TestClient,
  mobileNumber = numbers.engineer,
  fullName = "Eng One",
): Promise<{ client: TestClient; id: string }> {
  const created = await admin.post("/api/v1/admin/engineers", { fullName, mobileNumber, temporaryPassword: "temporary-pass-123" });
  assert.equal(created.status, 201, created.text);
  const id = String((created.body.data?.["engineer"] as Json)["id"]);
  const client = await loginAs(ctx, mobileNumber, "temporary-pass-123");
  const changed = await client.post("/api/v1/profile/password", {
    currentPassword: "temporary-pass-123",
    newPassword: ENGINEER_PASSWORD,
    confirmNewPassword: ENGINEER_PASSWORD,
  });
  assert.equal(changed.status, 200, changed.text);
  return { client, id };
}

/** Citizen submits a gallery report (no EXIF → location flagged) and returns its id. */
export async function submitReport(citizen: TestClient, description?: string): Promise<string> {
  const form = new FormData();
  form.append("captureMethod", "GALLERY_UPLOAD");
  form.append("latitude", "31.5204");
  form.append("longitude", "74.3587");
  if (description !== undefined) form.append("description", description);
  form.append("image", new Blob([new Uint8Array(await makeJpeg())], { type: "image/jpeg" }), "road.jpg");
  const res = await citizen.postForm("/api/v1/reports", form);
  assert.equal(res.status, 201, res.text);
  return String((res.body.data?.["report"] as Json)["id"]);
}

export function reportOf(res: TestResponse): Json {
  return res.body.data?.["report"] as Json;
}

/** Submit → review → accept. Returns the report id. */
export async function acceptedReport(admin: TestClient, citizen: TestClient): Promise<string> {
  const id = await submitReport(citizen);
  assert.equal((await admin.post(`/api/v1/admin/reports/${id}/review`)).status, 200);
  const accepted = await admin.post(`/api/v1/admin/reports/${id}/decision`, { decision: "ACCEPT" });
  assert.equal(accepted.status, 200, accepted.text);
  return id;
}

/** Citizen-facing SMS (OTP codes excluded) sent to `to` since index `from`. */
export function citizenSms(ctx: AuthTestContext, to: string, from = 0): string[] {
  return ctx.sms.messages
    .slice(from)
    .filter((m) => m.to === to && !/verification code/i.test(m.message))
    .map((m) => m.message);
}

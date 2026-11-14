import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { runAccountPasswordReset } from "../src/scripts/accountPasswordReset.js";
import type { Prompter } from "../src/scripts/prompt.js";
import { createAdminAccount } from "../src/services/adminBootstrap.service.js";
import { PasswordResetError } from "../src/services/passwordReset.service.js";
import {
  createVerifiedCitizen,
  numbers,
  PASSWORD,
  startAuthTestApp,
  type AuthTestContext,
  type TestClient,
} from "./helpers/authTestApp.js";
import { makeJpeg } from "./helpers/testImages.js";
import { setupTestDatabase, skipWithoutDatabase, type TestDatabase } from "./helpers/testDb.js";

const NEW_PASSWORD = "brand-new-password-42";

/** Answers questions in order, recording which ones were asked with hidden input. */
class ScriptedPrompter implements Prompter {
  readonly asked: { question: string; hidden: boolean }[] = [];
  constructor(private readonly answers: string[]) {}
  ask(question: string, hidden = false): Promise<string> {
    this.asked.push({ question, hidden });
    const answer = this.answers.shift();
    return answer === undefined ? Promise.reject(new Error(`unexpected question: ${question}`)) : Promise.resolve(answer);
  }
  close(): void {}
}

describe("account password reset CLI", { skip: skipWithoutDatabase }, () => {
  let db: TestDatabase;
  let ctx: AuthTestContext;

  async function run(answers: string[]) {
    const prompt = new ScriptedPrompter(answers);
    const output: string[] = [];
    const outcome = await runAccountPasswordReset({ prisma: db.prisma, prompt, print: (line) => output.push(line), defaultCountry: undefined });
    return { outcome, prompt, output: output.join("\n") };
  }

  async function runExpectingError(answers: string[], pattern: RegExp): Promise<void> {
    await assert.rejects(run(answers), (error: unknown) => {
      assert.ok(error instanceof PasswordResetError, String(error));
      assert.match(error.message, pattern);
      return true;
    });
  }

  const hashes = async () =>
    (await db.prisma.user.findMany({ select: { mobileNumber: true, passwordHash: true }, orderBy: { mobileNumber: "asc" } })).map(
      (u) => `${u.mobileNumber}:${u.passwordHash}`,
    );
  const activeSessions = (mobileNumber: string) =>
    db.prisma.refreshToken.count({ where: { user: { mobileNumber }, revokedAt: null } });

  async function login(mobileNumber: string, password: string) {
    const client = ctx.client();
    const res = await client.post("/api/v1/auth/login", { mobileNumber, password });
    return { client, res };
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
  });

  it("resets a citizen's password, ends their sessions and keeps everything else", async () => {
    const citizen: TestClient = await createVerifiedCitizen(ctx);
    // The citizen has a report, which must survive the reset.
    const form = new FormData();
    form.append("captureMethod", "GALLERY_UPLOAD");
    form.append("latitude", "31.5");
    form.append("longitude", "74.3");
    form.append("image", new Blob([new Uint8Array(await makeJpeg())], { type: "image/jpeg" }), "r.jpg");
    assert.equal((await citizen.postForm("/api/v1/reports", form)).status, 201);

    const before = await db.prisma.user.findUniqueOrThrow({ where: { mobileNumber: numbers.citizen } });
    assert.equal(await activeSessions(numbers.citizen), 1);

    const { outcome, prompt, output } = await run([numbers.citizen, "yes", NEW_PASSWORD, NEW_PASSWORD]);
    assert.equal(outcome, "reset");
    assert.match(output, /Name: {3}Test Citizen/);
    assert.match(output, /Role: {3}Citizen/);
    assert.match(output, /1 existing login session\(s\) were signed out/);

    // Passwords are asked with hidden input; nothing secret is ever printed.
    assert.deepEqual(prompt.asked.map((q) => q.hidden), [false, false, true, true]);
    assert.ok(!output.includes(NEW_PASSWORD) && !output.includes(PASSWORD));
    assert.ok(!output.includes("$argon2"));

    // Only the password hash changed.
    const after = await db.prisma.user.findUniqueOrThrow({ where: { mobileNumber: numbers.citizen } });
    assert.notEqual(after.passwordHash, before.passwordHash);
    assert.match(after.passwordHash, /^\$argon2id\$/);
    const { passwordHash: _a, updatedAt: _b, ...restAfter } = after;
    const { passwordHash: _c, updatedAt: _d, ...restBefore } = before;
    assert.deepEqual(restAfter, restBefore);
    assert.equal(await db.prisma.report.count({ where: { citizenId: after.id } }), 1);

    // Sessions are invalidated: the old login can no longer be refreshed.
    assert.equal(await activeSessions(numbers.citizen), 0);
    const refresh = await citizen.post("/api/v1/auth/refresh");
    assert.equal(refresh.status, 401);

    // Old password fails, new password works.
    assert.equal((await login(numbers.citizen, PASSWORD)).res.status, 401);
    assert.equal((await login(numbers.citizen, NEW_PASSWORD)).res.status, 200);
  });

  it("resets admin and engineer accounts and keeps their role and flags", async () => {
    await createAdminAccount(db.prisma, { fullName: "Admin One", mobileNumber: numbers.admin, password: PASSWORD }, { allowAdditional: false });
    const { client: admin } = await login(numbers.admin, PASSWORD);
    const created = await admin.post("/api/v1/admin/engineers", {
      fullName: "Eng One",
      mobileNumber: numbers.engineer,
      temporaryPassword: "temporary-pass-123",
    });
    assert.equal(created.status, 201);

    const adminRun = await run([numbers.admin, "yes", NEW_PASSWORD, NEW_PASSWORD]);
    assert.match(adminRun.output, /Role: {3}Admin/);
    const adminRow = await db.prisma.user.findUniqueOrThrow({ where: { mobileNumber: numbers.admin } });
    assert.deepEqual([adminRow.role, adminRow.status], ["ADMIN", "ACTIVE"]);
    assert.equal((await admin.post("/api/v1/auth/refresh")).status, 401, "admin session ended");
    assert.equal((await login(numbers.admin, NEW_PASSWORD)).res.status, 200);

    const engineerRun = await run([numbers.engineer, "yes", NEW_PASSWORD, NEW_PASSWORD]);
    assert.match(engineerRun.output, /Role: {3}Engineer/);
    const engineer = await db.prisma.user.findUniqueOrThrow({ where: { mobileNumber: numbers.engineer } });
    assert.deepEqual([engineer.role, engineer.status], ["ENGINEER", "ACTIVE"]);
    // The engineer had never replaced the admin's temporary password; that requirement is kept.
    assert.equal(engineer.mustChangePassword, true);
    const engineerLogin = await login(numbers.engineer, NEW_PASSWORD);
    assert.equal(engineerLogin.res.status, 200);
  });

  it("refuses a mobile number that has no account and changes nothing", async () => {
    await createVerifiedCitizen(ctx);
    const snapshot = await hashes();
    await runExpectingError(["+12025550188", "yes", NEW_PASSWORD, NEW_PASSWORD], /No account uses \+12025550188\. Nothing was changed/);
    assert.deepEqual(await hashes(), snapshot);
    await runExpectingError(["not-a-number"], /not a valid mobile number/);
    assert.deepEqual(await hashes(), snapshot);
  });

  it("refuses mismatched passwords and keeps the old password and sessions", async () => {
    const citizen = await createVerifiedCitizen(ctx);
    const snapshot = await hashes();
    await runExpectingError([numbers.citizen, "yes", NEW_PASSWORD, "something-else-123"], /do not match\. Nothing was changed/);
    assert.deepEqual(await hashes(), snapshot);
    assert.equal(await activeSessions(numbers.citizen), 1);
    assert.equal((await citizen.post("/api/v1/auth/refresh")).status, 200, "session still valid");
    assert.equal((await login(numbers.citizen, PASSWORD)).res.status, 200);
  });

  it("applies the normal password rules", async () => {
    await createVerifiedCitizen(ctx);
    const snapshot = await hashes();
    await runExpectingError([numbers.citizen, "yes", "short"], /at least 8 characters\. Nothing was changed/);
    await runExpectingError([numbers.citizen, "yes", "x".repeat(129)], /at most 128 characters/);
    assert.deepEqual(await hashes(), snapshot);
  });

  it("does nothing unless the operator types yes", async () => {
    await createVerifiedCitizen(ctx);
    const snapshot = await hashes();
    const { outcome, output, prompt } = await run([numbers.citizen, "no"]);
    assert.equal(outcome, "cancelled");
    assert.match(output, /Cancelled\. Nothing was changed/);
    assert.equal(prompt.asked.length, 2, "no password was asked");
    assert.deepEqual(await hashes(), snapshot);
  });

  it("does not verify or activate a citizen who is pending verification", async () => {
    const client = ctx.client();
    const registered = await client.post("/api/v1/auth/register", {
      fullName: "Pending Citizen",
      mobileNumber: numbers.citizen2,
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    assert.equal(registered.status, 201);

    const { outcome, output } = await run([numbers.citizen2, "yes", NEW_PASSWORD, NEW_PASSWORD]);
    assert.equal(outcome, "reset");
    assert.match(output, /Status: Pending mobile verification/);
    assert.match(output, /does NOT verify or activate the account/);
    assert.match(output, /STILL pending mobile verification/);

    const row = await db.prisma.user.findUniqueOrThrow({ where: { mobileNumber: numbers.citizen2 } });
    assert.equal(row.status, "PENDING_VERIFICATION");
    assert.equal(row.mobileVerifiedAt, null);
    // The new password is accepted, but login still requires verification first.
    const res = (await login(numbers.citizen2, NEW_PASSWORD)).res;
    assert.equal(res.status, 403);
    assert.equal(res.body.error?.code, "ACCOUNT_NOT_VERIFIED");
  });
});

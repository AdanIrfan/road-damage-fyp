import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { OTP_MAX_ATTEMPTS, OTP_MAX_SENDS_PER_HOUR } from "../src/config/auth.js";
import {
  createVerifiedCitizen,
  numbers,
  PASSWORD,
  startAuthTestApp,
  type AuthTestContext,
  type TestClient,
} from "./helpers/authTestApp.js";
import { setupTestDatabase, skipWithoutDatabase, type TestDatabase } from "./helpers/testDb.js";

const registration = (mobileNumber = numbers.citizen) => ({
  fullName: "Amina Citizen",
  mobileNumber,
  password: PASSWORD,
  confirmPassword: PASSWORD,
});

describe("authentication", { skip: skipWithoutDatabase }, () => {
  let db: TestDatabase;
  let ctx: AuthTestContext;

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
  });

  describe("registration", () => {
    it("creates an unverified citizen, hashes the password and sends a hashed OTP", async () => {
      const client = ctx.client();
      const res = await client.post("/api/v1/auth/register", registration(" +1 (202) 555-0101 "));
      assert.equal(res.status, 201);
      assert.equal(res.body.data?.["mobileNumber"], numbers.citizen, "number is normalized to E.164");

      const user = await db.prisma.user.findUniqueOrThrow({ where: { mobileNumber: numbers.citizen } });
      assert.equal(user.role, "CITIZEN");
      assert.equal(user.status, "PENDING_VERIFICATION");
      assert.match(user.passwordHash, /^\$argon2id\$/);
      assert.ok(!user.passwordHash.includes(PASSWORD));

      const code = ctx.sms.lastCodeFor(numbers.citizen);
      const otp = await db.prisma.otpCode.findFirstOrThrow({ where: { userId: user.id } });
      assert.notEqual(otp.codeHash, code, "OTP must not be stored in plaintext");
      assert.match(otp.codeHash, /^[0-9a-f]{64}$/);
      assert.ok(!res.text.includes(code), "OTP must not be returned by the API");
    });

    it("rejects a mobile number that already belongs to a verified account", async () => {
      await createVerifiedCitizen(ctx);
      const res = await ctx.client().post("/api/v1/auth/register", registration());
      assert.equal(res.status, 409);
      assert.equal(res.body.error?.code, "MOBILE_ALREADY_REGISTERED");
    });

    it("lets an unverified registration be replaced (no number squatting) after the resend cooldown", async () => {
      await ctx.client().post("/api/v1/auth/register", registration());
      const tooSoon = await ctx.client().post("/api/v1/auth/register", { ...registration(), fullName: "Real Owner" });
      assert.equal(tooSoon.status, 429);

      ctx.clock.advanceSeconds(61);
      const res = await ctx.client().post("/api/v1/auth/register", { ...registration(), fullName: "Real Owner" });
      assert.equal(res.status, 201);
      assert.equal(await db.prisma.user.count(), 1);
      const user = await db.prisma.user.findUniqueOrThrow({ where: { mobileNumber: numbers.citizen } });
      assert.equal(user.fullName, "Real Owner");
    });

    it("validates the request body", async () => {
      const client = ctx.client();
      const cases: { body: unknown; field: string }[] = [
        { body: { ...registration(), confirmPassword: "different-password" }, field: "confirmPassword" },
        { body: { ...registration(), password: "short", confirmPassword: "short" }, field: "password" },
        { body: { ...registration(), fullName: " " }, field: "fullName" },
        { body: { ...registration(), mobileNumber: "12345" }, field: "mobileNumber" },
        { body: { ...registration(), mobileNumber: "+442071838750" }, field: "mobileNumber" }, // landline
        { body: { mobileNumber: numbers.citizen }, field: "fullName" },
      ];
      for (const { body, field } of cases) {
        const res = await client.post("/api/v1/auth/register", body);
        assert.equal(res.status, 400, field);
        assert.equal(res.body.error?.code, "VALIDATION_ERROR");
        const fields = res.body.error?.details?.["fields"] as Record<string, unknown>;
        assert.ok(field in fields, `expected an error for ${field}`);
      }
      const extra = await client.post("/api/v1/auth/register", { ...registration(), role: "ADMIN" });
      assert.equal(extra.status, 400, "unknown fields such as role are rejected");
      assert.equal(await db.prisma.user.count(), 0);
    });
  });

  describe("mobile verification (OTP)", () => {
    it("activates the account with the correct code and the code cannot be reused", async () => {
      const client = ctx.client();
      await client.post("/api/v1/auth/register", registration());
      const code = ctx.sms.lastCodeFor(numbers.citizen);

      const ok = await client.post("/api/v1/auth/otp/verify", { mobileNumber: numbers.citizen, code });
      assert.equal(ok.status, 200);
      const user = await db.prisma.user.findUniqueOrThrow({ where: { mobileNumber: numbers.citizen } });
      assert.equal(user.status, "ACTIVE");
      assert.ok(user.mobileVerifiedAt instanceof Date);

      const reused = await client.post("/api/v1/auth/otp/verify", { mobileNumber: numbers.citizen, code });
      assert.equal(reused.status, 400);
      assert.equal(reused.body.error?.code, "OTP_INVALID");
    });

    it("rejects incorrect codes and burns the code after too many attempts", async () => {
      const client = ctx.client();
      await client.post("/api/v1/auth/register", registration());
      const code = ctx.sms.lastCodeFor(numbers.citizen);
      const wrong = code === "000000" ? "111111" : "000000";

      const first = await client.post("/api/v1/auth/otp/verify", { mobileNumber: numbers.citizen, code: wrong });
      assert.equal(first.status, 400);
      assert.equal(first.body.error?.code, "OTP_INVALID");
      assert.equal(first.body.error?.details?.["attemptsRemaining"], OTP_MAX_ATTEMPTS - 1);

      let last = first;
      for (let i = 1; i < OTP_MAX_ATTEMPTS; i += 1) {
        last = await client.post("/api/v1/auth/otp/verify", { mobileNumber: numbers.citizen, code: wrong });
      }
      assert.equal(last.body.error?.code, "OTP_ATTEMPTS_EXCEEDED");

      const correctButBurned = await client.post("/api/v1/auth/otp/verify", { mobileNumber: numbers.citizen, code });
      assert.equal(correctButBurned.status, 400);
      const user = await db.prisma.user.findUniqueOrThrow({ where: { mobileNumber: numbers.citizen } });
      assert.equal(user.status, "PENDING_VERIFICATION");
    });

    it("rejects an expired code", async () => {
      const client = ctx.client();
      await client.post("/api/v1/auth/register", registration());
      const code = ctx.sms.lastCodeFor(numbers.citizen);
      ctx.clock.advanceSeconds(10 * 60 + 1);
      const res = await client.post("/api/v1/auth/otp/verify", { mobileNumber: numbers.citizen, code });
      assert.equal(res.status, 400);
      assert.equal(res.body.error?.code, "OTP_EXPIRED");
    });

    it("validates the code format", async () => {
      const res = await ctx.client().post("/api/v1/auth/otp/verify", { mobileNumber: numbers.citizen, code: "12ab" });
      assert.equal(res.status, 400);
      assert.equal(res.body.error?.code, "VALIDATION_ERROR");
    });

    it("enforces the resend cooldown and the hourly limit, and only the newest code works", async () => {
      const client = ctx.client();
      await client.post("/api/v1/auth/register", registration());
      const firstCode = ctx.sms.lastCodeFor(numbers.citizen);

      const tooSoon = await client.post("/api/v1/auth/otp/resend", { mobileNumber: numbers.citizen });
      assert.equal(tooSoon.status, 429);
      assert.equal(tooSoon.body.error?.code, "OTP_RESEND_TOO_SOON");
      assert.ok(Number(tooSoon.body.error?.details?.["retryAfterSeconds"]) > 0);

      for (let sent = 1; sent < OTP_MAX_SENDS_PER_HOUR; sent += 1) {
        ctx.clock.advanceSeconds(61);
        const res = await client.post("/api/v1/auth/otp/resend", { mobileNumber: numbers.citizen });
        assert.equal(res.status, 200, `resend ${sent}`);
      }
      ctx.clock.advanceSeconds(61);
      const limited = await client.post("/api/v1/auth/otp/resend", { mobileNumber: numbers.citizen });
      assert.equal(limited.status, 429);
      assert.equal(limited.body.error?.code, "OTP_RESEND_LIMIT");

      const stale = await client.post("/api/v1/auth/otp/verify", { mobileNumber: numbers.citizen, code: firstCode });
      if (firstCode !== ctx.sms.lastCodeFor(numbers.citizen)) {
        assert.equal(stale.status, 400, "superseded codes are invalid");
      }
      const fresh = await client.post("/api/v1/auth/otp/verify", {
        mobileNumber: numbers.citizen,
        code: ctx.sms.lastCodeFor(numbers.citizen),
      });
      assert.equal(fresh.status, 200);
    });

    it("does not send codes for unknown or already verified numbers", async () => {
      const res = await ctx.client().post("/api/v1/auth/otp/resend", { mobileNumber: numbers.citizen2 });
      assert.equal(res.status, 200);
      assert.equal(ctx.sms.messages.length, 0);
    });
  });

  describe("login", () => {
    it("refuses unverified citizens, but only after a correct password", async () => {
      await ctx.client().post("/api/v1/auth/register", registration());
      const wrong = await ctx.client().post("/api/v1/auth/login", { mobileNumber: numbers.citizen, password: "wrong-password" });
      assert.equal(wrong.status, 401);
      assert.equal(wrong.body.error?.code, "INVALID_CREDENTIALS");

      const right = await ctx.client().post("/api/v1/auth/login", { mobileNumber: numbers.citizen, password: PASSWORD });
      assert.equal(right.status, 403);
      assert.equal(right.body.error?.code, "ACCOUNT_NOT_VERIFIED");
      assert.equal(right.setCookies.length, 0, "no session for unverified accounts");
    });

    it("sets secure httpOnly cookies and never returns secrets", async () => {
      const client = await createVerifiedCitizen(ctx);
      const fresh = ctx.client();
      const res = await fresh.post("/api/v1/auth/login", { mobileNumber: numbers.citizen, password: PASSWORD });
      assert.equal(res.status, 200);

      const access = res.setCookies.find((c) => c.startsWith("access_token="));
      const refresh = res.setCookies.find((c) => c.startsWith("refresh_token="));
      assert.ok(access !== undefined && refresh !== undefined);
      for (const cookie of [access, refresh]) {
        assert.match(cookie, /HttpOnly/i);
        assert.match(cookie, /SameSite=Lax/i);
      }
      assert.match(access, /Path=\/api(;|$)/);
      assert.match(refresh, /Path=\/api\/v1\/auth(;|$)/);

      const user = res.body.data?.["user"] as Record<string, unknown>;
      assert.equal(user["role"], "CITIZEN");
      for (const secret of ["passwordHash", "password_hash", "$argon2", "codeHash", "tokenHash"]) {
        assert.ok(!res.text.includes(secret), `response must not contain ${secret}`);
      }
      assert.ok(!res.text.includes(fresh.cookies.get("refresh_token") ?? "x"), "tokens only travel in cookies");
      assert.ok(client.cookies.has("access_token"));
    });

    it("rejects wrong passwords and unknown numbers with the same message", async () => {
      await createVerifiedCitizen(ctx);
      const wrongPassword = await ctx.client().post("/api/v1/auth/login", { mobileNumber: numbers.citizen, password: "nope-nope" });
      const unknown = await ctx.client().post("/api/v1/auth/login", { mobileNumber: numbers.citizen2, password: PASSWORD });
      const badNumber = await ctx.client().post("/api/v1/auth/login", { mobileNumber: "not-a-number", password: PASSWORD });
      for (const res of [wrongPassword, unknown, badNumber]) {
        assert.equal(res.status, 401);
        assert.equal(res.body.error?.code, "INVALID_CREDENTIALS");
      }
      assert.equal(wrongPassword.body.error?.message, unknown.body.error?.message);
    });
  });

  describe("sessions", () => {
    it("requires authentication for /auth/me", async () => {
      const res = await ctx.client().get("/api/v1/auth/me");
      assert.equal(res.status, 401);
      assert.equal(res.body.error?.code, "UNAUTHENTICATED");
    });

    it("returns the current user with a valid session", async () => {
      const client = await createVerifiedCitizen(ctx);
      const res = await client.get("/api/v1/auth/me");
      assert.equal(res.status, 200);
      assert.equal((res.body.data?.["user"] as Record<string, unknown>)["mobileNumber"], numbers.citizen);
    });

    it("reports an expired access token, and refresh issues a new one", async () => {
      const client = await createVerifiedCitizen(ctx);
      ctx.clock.advanceSeconds(16 * 60);
      const expired = await client.get("/api/v1/auth/me");
      assert.equal(expired.status, 401);
      assert.equal(expired.body.error?.code, "TOKEN_EXPIRED");

      const refreshed = await client.post("/api/v1/auth/refresh");
      assert.equal(refreshed.status, 200);
      const me = await client.get("/api/v1/auth/me");
      assert.equal(me.status, 200);
    });

    it("rotates refresh tokens and revokes the whole session when an old one is reused", async () => {
      const client = await createVerifiedCitizen(ctx);
      const original = client.cookies.get("refresh_token");
      const rotated = await client.post("/api/v1/auth/refresh");
      assert.equal(rotated.status, 200);
      const current = client.cookies.get("refresh_token");
      assert.ok(original !== undefined && current !== undefined && original !== current, "refresh token changes");

      // An attacker replays the old token.
      const attacker = ctx.client();
      attacker.cookies.set("refresh_token", original);
      const replay = await attacker.post("/api/v1/auth/refresh");
      assert.equal(replay.status, 401);
      assert.equal(replay.body.error?.code, "SESSION_INVALID");

      // The legitimate (newer) token is now revoked too.
      const legit = await client.post("/api/v1/auth/refresh");
      assert.equal(legit.status, 401);
      const active = await db.prisma.refreshToken.count({ where: { revokedAt: null } });
      assert.equal(active, 0);
    });

    it("treats two simultaneous refreshes with the same token as reuse (why the frontend serialises refreshes across tabs)", async () => {
      const tabA = await createVerifiedCitizen(ctx);
      // A second browser tab shares the same cookies.
      const tabB = ctx.client();
      for (const [name, value] of tabA.cookies) {
        tabB.cookies.set(name, value);
      }
      const [a, b] = await Promise.all([tabA.post("/api/v1/auth/refresh"), tabB.post("/api/v1/auth/refresh")]);
      assert.deepEqual([a.status, b.status].sort(), [200, 401]);
      // Theft detection is unchanged: the whole session is revoked, so the user would be logged out.
      assert.equal(await db.prisma.refreshToken.count({ where: { revokedAt: null } }), 0);
    });

    it("rejects refresh without a cookie or with an unknown token", async () => {
      const none = await ctx.client().post("/api/v1/auth/refresh");
      assert.equal(none.status, 401);
      const forged = ctx.client();
      forged.cookies.set("refresh_token", "forged-token-value");
      const res = await forged.post("/api/v1/auth/refresh");
      assert.equal(res.status, 401);
    });

    it("logout revokes the refresh session and clears the cookies", async () => {
      const client = await createVerifiedCitizen(ctx);
      const refreshToken = client.cookies.get("refresh_token");
      const res = await client.post("/api/v1/auth/logout");
      assert.equal(res.status, 200);
      assert.ok(res.setCookies.some((c) => c.startsWith("access_token=;")), "access cookie cleared");
      assert.ok(res.setCookies.some((c) => c.startsWith("refresh_token=;")), "refresh cookie cleared");
      assert.equal(client.cookies.has("access_token"), false);

      assert.equal((await client.get("/api/v1/auth/me")).status, 401);
      const replay = ctx.client();
      replay.cookies.set("refresh_token", refreshToken ?? "");
      assert.equal((await replay.post("/api/v1/auth/refresh")).status, 401, "revoked token is rejected");
    });
  });

  describe("CSRF and origin checks", () => {
    it("rejects state-changing requests without a CSRF token", async () => {
      const client = ctx.client();
      const res = await client.request("POST", "/api/v1/auth/login", { mobileNumber: numbers.citizen, password: PASSWORD }, { csrf: false });
      assert.equal(res.status, 403);
      assert.equal(res.body.error?.code, "CSRF_TOKEN_INVALID");
    });

    it("rejects a header that does not match the cookie, and forged tokens", async () => {
      const client = ctx.client();
      const token = await client.getCsrfToken();
      const [nonce] = token.split(".");
      for (const header of [`${token}x`, `${nonce}.forgedsignature`]) {
        const res = await client.request("POST", "/api/v1/auth/logout", {}, { csrf: false, headers: { "x-csrf-token": header } });
        assert.equal(res.status, 403, header);
      }
      // A forged token in both cookie and header still fails the signature check.
      const forger = ctx.client();
      forger.cookies.set("csrf_token", "abc.def");
      const forged = await forger.request("POST", "/api/v1/auth/logout", {}, { csrf: false, headers: { "x-csrf-token": "abc.def" } });
      assert.equal(forged.status, 403);
    });

    it("issues an httpOnly CSRF cookie and accepts the matching header", async () => {
      const client = ctx.client();
      const res = await client.get("/api/v1/auth/csrf");
      assert.ok(res.setCookies.some((c) => c.startsWith("csrf_token=") && /HttpOnly/i.test(c)));
      const logout = await client.post("/api/v1/auth/logout");
      assert.equal(logout.status, 200);
    });

    it("rejects requests from origins that are not allowed", async () => {
      const client = ctx.client();
      const res = await client.request("POST", "/api/v1/auth/login", { mobileNumber: numbers.citizen, password: PASSWORD }, {
        headers: { origin: "https://evil.example.com" },
      });
      assert.equal(res.status, 403);
      assert.equal(res.body.error?.code, "CORS_ORIGIN_NOT_ALLOWED");
    });
  });

  describe("profile", () => {
    it("updates the own profile and validates input", async () => {
      const client = await createVerifiedCitizen(ctx);
      const res = await client.patch("/api/v1/profile", { fullName: "  New Name  " });
      assert.equal(res.status, 200);
      assert.equal((res.body.data?.["user"] as Record<string, unknown>)["fullName"], "New Name");

      const invalid = await client.patch("/api/v1/profile", { fullName: "x", role: "ADMIN" });
      assert.equal(invalid.status, 400);
      const user = await db.prisma.user.findUniqueOrThrow({ where: { mobileNumber: numbers.citizen } });
      assert.equal(user.role, "CITIZEN");
    });

    it("changes the password and logs out other sessions", async () => {
      const laptop = await createVerifiedCitizen(ctx);
      const phone = ctx.client();
      await phone.post("/api/v1/auth/login", { mobileNumber: numbers.citizen, password: PASSWORD });

      const wrongCurrent = await laptop.post("/api/v1/profile/password", {
        currentPassword: "not-my-password",
        newPassword: "brand-new-password",
        confirmNewPassword: "brand-new-password",
      });
      assert.equal(wrongCurrent.status, 400);

      const changed = await laptop.post("/api/v1/profile/password", {
        currentPassword: PASSWORD,
        newPassword: "brand-new-password",
        confirmNewPassword: "brand-new-password",
      });
      assert.equal(changed.status, 200);
      assert.equal((await laptop.get("/api/v1/auth/me")).status, 200, "current device stays logged in");
      assert.equal((await phone.post("/api/v1/auth/refresh")).status, 401, "other device is logged out");

      const oldLogin = await ctx.client().post("/api/v1/auth/login", { mobileNumber: numbers.citizen, password: PASSWORD });
      assert.equal(oldLogin.status, 401);
      const newLogin = await ctx.client().post("/api/v1/auth/login", { mobileNumber: numbers.citizen, password: "brand-new-password" });
      assert.equal(newLogin.status, 200);
    });
  });
});

describe("rate limiting", { skip: skipWithoutDatabase }, () => {
  let db: TestDatabase;
  let ctx: AuthTestContext;
  let client: TestClient;

  before(async () => {
    db = setupTestDatabase();
    await db.reset();
    ctx = await startAuthTestApp(db.prisma, { rateLimiting: true });
    client = ctx.client();
  });
  after(async () => {
    await ctx.close();
    await db.close();
  });

  it("limits repeated login attempts per IP", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      const res = await client.post("/api/v1/auth/login", { mobileNumber: numbers.citizen, password: "wrong-password" });
      statuses.push(res.status);
    }
    assert.deepEqual(statuses.slice(0, 10), Array<number>(10).fill(401));
    assert.equal(statuses[10], 429);
  });
});

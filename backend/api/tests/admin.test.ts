import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { AdminBootstrapError, createAdminAccount } from "../src/services/adminBootstrap.service.js";
import {
  createVerifiedCitizen,
  numbers,
  PASSWORD,
  startAuthTestApp,
  type AuthTestContext,
  type TestClient,
} from "./helpers/authTestApp.js";
import { setupTestDatabase, skipWithoutDatabase, type TestDatabase } from "./helpers/testDb.js";

const TEMP_PASSWORD = "temporary-pass-123";
const NEW_ENGINEER_PASSWORD = "engineer-own-password";

describe("admin engineer management", { skip: skipWithoutDatabase }, () => {
  let db: TestDatabase;
  let ctx: AuthTestContext;
  let admin: TestClient;

  const engineerInput = (mobileNumber = numbers.engineer) => ({
    fullName: "Eng Bilal",
    mobileNumber,
    temporaryPassword: TEMP_PASSWORD,
  });

  async function loginAs(mobileNumber: string, password: string): Promise<TestClient> {
    const client = ctx.client();
    const res = await client.post("/api/v1/auth/login", { mobileNumber, password });
    assert.equal(res.status, 200, `login ${mobileNumber}`);
    return client;
  }

  async function createEngineer(mobileNumber = numbers.engineer): Promise<string> {
    const res = await admin.post("/api/v1/admin/engineers", engineerInput(mobileNumber));
    assert.equal(res.status, 201);
    return String((res.body.data?.["engineer"] as Record<string, unknown>)["id"]);
  }

  /** Logs in as the engineer and replaces the temporary password. */
  async function activeEngineer(mobileNumber = numbers.engineer): Promise<TestClient> {
    const client = await loginAs(mobileNumber, TEMP_PASSWORD);
    const res = await client.post("/api/v1/profile/password", {
      currentPassword: TEMP_PASSWORD,
      newPassword: NEW_ENGINEER_PASSWORD,
      confirmNewPassword: NEW_ENGINEER_PASSWORD,
    });
    assert.equal(res.status, 200);
    return client;
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
    await createAdminAccount(db.prisma, { fullName: "Admin One", mobileNumber: numbers.admin, password: PASSWORD }, { allowAdditional: false });
    admin = await loginAs(numbers.admin, PASSWORD);
  });

  describe("authorization", () => {
    it("requires authentication", async () => {
      const res = await ctx.client().get("/api/v1/admin/engineers");
      assert.equal(res.status, 401);
    });

    it("forbids citizens", async () => {
      const citizen = await createVerifiedCitizen(ctx);
      assert.equal((await citizen.get("/api/v1/admin/engineers")).status, 403);
      const create = await citizen.post("/api/v1/admin/engineers", engineerInput());
      assert.equal(create.status, 403);
      assert.equal(create.body.error?.code, "FORBIDDEN");
      assert.equal(await db.prisma.user.count({ where: { role: "ENGINEER" } }), 0);
    });

    it("forbids engineers, including access to other engineers' details", async () => {
      await createEngineer(numbers.engineer);
      const otherId = await createEngineer(numbers.engineer2);
      const engineer = await activeEngineer(numbers.engineer);
      for (const path of ["/api/v1/admin/engineers", `/api/v1/admin/engineers/${otherId}`]) {
        const res = await engineer.get(path);
        assert.equal(res.status, 403, path);
      }
      const status = await engineer.patch(`/api/v1/admin/engineers/${otherId}/status`, { status: "DEACTIVATED" });
      assert.equal(status.status, 403);
    });

    it("has no public way to register an admin", async () => {
      const res = await ctx.client().post("/api/v1/auth/register", {
        fullName: "Wannabe Admin",
        mobileNumber: numbers.citizen2,
        password: PASSWORD,
        confirmPassword: PASSWORD,
        role: "ADMIN",
      });
      assert.equal(res.status, 400);
      assert.equal(await db.prisma.user.count({ where: { role: "ADMIN" } }), 1);
    });
  });

  describe("engineer accounts", () => {
    it("creates an engineer with a temporary password that must be changed", async () => {
      const res = await admin.post("/api/v1/admin/engineers", engineerInput());
      assert.equal(res.status, 201);
      const engineer = res.body.data?.["engineer"] as Record<string, unknown>;
      assert.equal(engineer["role"], "ENGINEER");
      assert.equal(engineer["status"], "ACTIVE");
      assert.equal(engineer["mustChangePassword"], true);
      assert.ok(!res.text.includes(TEMP_PASSWORD), "temporary password is never echoed");
      assert.ok(!res.text.includes("$argon2"));

      const client = await loginAs(numbers.engineer, TEMP_PASSWORD);
      const blocked = await client.patch("/api/v1/profile", { fullName: "Changed" });
      assert.equal(blocked.status, 403);
      assert.equal(blocked.body.error?.code, "PASSWORD_CHANGE_REQUIRED");
      assert.equal((await client.get("/api/v1/profile")).status, 200, "own profile is still visible");

      const changed = await client.post("/api/v1/profile/password", {
        currentPassword: TEMP_PASSWORD,
        newPassword: NEW_ENGINEER_PASSWORD,
        confirmNewPassword: NEW_ENGINEER_PASSWORD,
      });
      assert.equal(changed.status, 200);
      assert.equal((changed.body.data?.["user"] as Record<string, unknown>)["mustChangePassword"], false);
      assert.equal((await client.patch("/api/v1/profile", { fullName: "Changed" })).status, 200);
    });

    it("rejects duplicate mobile numbers and invalid input", async () => {
      await createEngineer();
      const duplicate = await admin.post("/api/v1/admin/engineers", engineerInput());
      assert.equal(duplicate.status, 409);

      const invalid = await admin.post("/api/v1/admin/engineers", { ...engineerInput(numbers.engineer2), temporaryPassword: "short" });
      assert.equal(invalid.status, 400);
      const badId = await admin.get("/api/v1/admin/engineers/not-a-uuid");
      assert.equal(badId.status, 400);
      const badQuery = await admin.get("/api/v1/admin/engineers?pageSize=1000");
      assert.equal(badQuery.status, 400);
    });

    it("lists engineers with pagination, search and status filter", async () => {
      await createEngineer(numbers.engineer);
      const secondId = await createEngineer(numbers.engineer2);
      await admin.patch(`/api/v1/admin/engineers/${secondId}`, { fullName: "Zara Field" });
      await createVerifiedCitizen(ctx); // citizens must never appear

      const all = await admin.get("/api/v1/admin/engineers?page=1&pageSize=1");
      assert.equal(all.status, 200);
      assert.equal(all.body.data?.["total"], 2);
      assert.equal((all.body.data?.["items"] as unknown[]).length, 1);

      const search = await admin.get("/api/v1/admin/engineers?search=zara");
      const items = search.body.data?.["items"] as Record<string, unknown>[];
      assert.deepEqual(items.map((item) => item["fullName"]), ["Zara Field"]);

      await admin.patch(`/api/v1/admin/engineers/${secondId}/status`, { status: "DEACTIVATED" });
      const deactivated = await admin.get("/api/v1/admin/engineers?status=DEACTIVATED");
      assert.equal(deactivated.body.data?.["total"], 1);
    });

    it("shows and updates one engineer, and 404s for non-engineers", async () => {
      const id = await createEngineer();
      const detail = await admin.get(`/api/v1/admin/engineers/${id}`);
      assert.equal(detail.status, 200);

      const updated = await admin.patch(`/api/v1/admin/engineers/${id}`, { mobileNumber: "+1 202 555 0129" });
      assert.equal(updated.status, 200);
      assert.equal((updated.body.data?.["engineer"] as Record<string, unknown>)["mobileNumber"], "+12025550129");

      const adminUser = await db.prisma.user.findUniqueOrThrow({ where: { mobileNumber: numbers.admin } });
      assert.equal((await admin.get(`/api/v1/admin/engineers/${adminUser.id}`)).status, 404);
      assert.equal((await admin.patch(`/api/v1/admin/engineers/${adminUser.id}/status`, { status: "DEACTIVATED" })).status, 404);
      assert.equal((await admin.patch(`/api/v1/admin/engineers/${id}`, {})).status, 400);
    });

    it("deactivation takes effect immediately and reactivation restores access", async () => {
      const id = await createEngineer();
      const engineer = await activeEngineer();
      assert.equal((await engineer.get("/api/v1/auth/me")).status, 200);

      const off = await admin.patch(`/api/v1/admin/engineers/${id}/status`, { status: "DEACTIVATED" });
      assert.equal(off.status, 200);
      assert.equal((await engineer.get("/api/v1/auth/me")).status, 401, "existing access token stops working");
      assert.equal((await engineer.post("/api/v1/auth/refresh")).status, 401, "refresh sessions were revoked");
      const login = await ctx.client().post("/api/v1/auth/login", { mobileNumber: numbers.engineer, password: NEW_ENGINEER_PASSWORD });
      assert.equal(login.status, 403);
      assert.equal(login.body.error?.code, "ACCOUNT_DEACTIVATED");

      await admin.patch(`/api/v1/admin/engineers/${id}/status`, { status: "ACTIVE" });
      await loginAs(numbers.engineer, NEW_ENGINEER_PASSWORD);
    });
  });
});

describe("admin bootstrap", { skip: skipWithoutDatabase }, () => {
  let db: TestDatabase;
  before(() => {
    db = setupTestDatabase();
  });
  after(() => db.close());
  beforeEach(() => db.reset());

  const input = (mobileNumber: string) => ({ fullName: "Admin", mobileNumber, password: PASSWORD });

  it("creates the first admin and refuses a second unless explicitly additional", async () => {
    const first = await createAdminAccount(db.prisma, input(numbers.admin), { allowAdditional: false });
    assert.equal(first.role, "ADMIN");
    await assert.rejects(createAdminAccount(db.prisma, input(numbers.citizen), { allowAdditional: false }), AdminBootstrapError);
    const second = await createAdminAccount(db.prisma, input(numbers.citizen), { allowAdditional: true });
    assert.equal(second.role, "ADMIN");
    await assert.rejects(createAdminAccount(db.prisma, input(numbers.admin), { allowAdditional: true }), AdminBootstrapError);
    assert.equal(await db.prisma.user.count({ where: { role: "ADMIN" } }), 2);
  });

  it("creates only one first admin when run concurrently", async () => {
    const results = await Promise.allSettled([
      createAdminAccount(db.prisma, input(numbers.admin), { allowAdditional: false }),
      createAdminAccount(db.prisma, input(numbers.citizen), { allowAdditional: false }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(await db.prisma.user.count({ where: { role: "ADMIN" } }), 1);
  });
});

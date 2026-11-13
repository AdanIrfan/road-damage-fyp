import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createApp } from "../src/app.js";
import type { DatabaseHealthCheck } from "../src/services/health.service.js";
import { startTestServer, type TestServer } from "./helpers/testServer.js";

const options = { exposeErrorStack: false, logRequests: false, corsOrigins: ["http://localhost:5173"] };

async function withServer(checkDatabase: DatabaseHealthCheck, run: (server: TestServer) => Promise<void>): Promise<void> {
  const server = await startTestServer(createApp({ checkDatabase }, options));
  try {
    await run(server);
  } finally {
    await server.close();
  }
}

describe("GET /api/health", () => {
  let server: TestServer;
  let databaseCalls = 0;

  before(async () => {
    server = await startTestServer(
      createApp({ checkDatabase: async () => { databaseCalls += 1; } }, options),
    );
  });
  after(() => server.close());

  it("returns 200 with status and timestamp", async () => {
    const res = await fetch(`${server.baseUrl}/api/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { success: boolean; data: { status: string; timestamp: string } };
    assert.equal(body.success, true);
    assert.equal(body.data.status, "ok");
    assert.ok(!Number.isNaN(Date.parse(body.data.timestamp)), "timestamp should be an ISO date");
  });

  it("does not touch the database", async () => {
    await fetch(`${server.baseUrl}/api/health`);
    assert.equal(databaseCalls, 0);
  });

  it("sets Helmet security headers and hides X-Powered-By", async () => {
    const res = await fetch(`${server.baseUrl}/api/health`);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("x-powered-by"), null);
  });
});

describe("GET /api/health/db", () => {
  it("returns 200 when the database check succeeds", async () => {
    await withServer(async () => {}, async (server) => {
      const res = await fetch(`${server.baseUrl}/api/health/db`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as { success: boolean; data: { status: string; database: string } };
      assert.deepEqual([body.success, body.data.status, body.data.database], [true, "ok", "up"]);
    });
  });

  it("returns 503 without leaking error details when the database is unavailable", async (t) => {
    t.mock.method(console, "error", () => {}); // the server logs the cause; keep test output clean
    const secretDetail = "connect ECONNREFUSED postgresql://road_damage_user:s3cret@localhost:5432";
    await withServer(async () => { throw new Error(secretDetail); }, async (server) => {
      const res = await fetch(`${server.baseUrl}/api/health/db`);
      assert.equal(res.status, 503);
      const text = await res.text();
      assert.ok(!text.includes("s3cret"), "password must not appear in the response");
      assert.ok(!text.includes("ECONNREFUSED"), "internal error must not appear in the response");
      assert.deepEqual(JSON.parse(text), {
        success: false,
        error: { code: "DATABASE_UNAVAILABLE", message: "Database is unavailable." },
      });
    });
  });
});

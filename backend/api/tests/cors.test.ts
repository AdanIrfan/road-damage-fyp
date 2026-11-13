import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createApp } from "../src/app.js";
import { startTestServer, type TestServer } from "./helpers/testServer.js";

const ALLOWED = "http://localhost:5173";
const ALSO_ALLOWED = "https://admin.example.com";
const DISALLOWED = "https://evil.example.com";

describe("CORS", () => {
  let server: TestServer;
  let databaseCalls = 0;

  before(async () => {
    server = await startTestServer(
      createApp(
        { checkDatabase: async () => { databaseCalls += 1; } },
        { exposeErrorStack: false, logRequests: false, corsOrigins: [ALLOWED, ALSO_ALLOWED] },
      ),
    );
  });
  after(() => server.close());

  it("echoes an allowed origin (never *) and allows credentials", async () => {
    for (const origin of [ALLOWED, ALSO_ALLOWED]) {
      const res = await fetch(`${server.baseUrl}/api/health`, { headers: { origin } });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("access-control-allow-origin"), origin);
      assert.equal(res.headers.get("access-control-allow-credentials"), "true");
      assert.match(res.headers.get("vary") ?? "", /Origin/);
    }
  });

  it("answers a preflight from an allowed origin with 204", async () => {
    const res = await fetch(`${server.baseUrl}/api/health`, {
      method: "OPTIONS",
      headers: {
        origin: ALLOWED,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type,authorization",
      },
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-origin"), ALLOWED);
    assert.match(res.headers.get("access-control-allow-methods") ?? "", /POST/);
    assert.equal(res.headers.get("access-control-allow-headers"), "Content-Type,Authorization");
    assert.equal(res.headers.get("access-control-max-age"), "600");
  });

  it("rejects a disallowed origin with 403 and no CORS headers", async () => {
    const res = await fetch(`${server.baseUrl}/api/health/db`, { headers: { origin: DISALLOWED } });
    assert.equal(res.status, 403);
    assert.equal(res.headers.get("access-control-allow-origin"), null);
    assert.deepEqual(await res.json(), {
      success: false,
      error: { code: "CORS_ORIGIN_NOT_ALLOWED", message: "This origin is not allowed to access the API." },
    });
    assert.equal(databaseCalls, 0, "rejected requests must not reach the route");
  });

  it("rejects a preflight from a disallowed origin with 403", async () => {
    const res = await fetch(`${server.baseUrl}/api/health`, {
      method: "OPTIONS",
      headers: { origin: DISALLOWED, "access-control-request-method": "POST" },
    });
    assert.equal(res.status, 403);
    assert.equal(res.headers.get("access-control-allow-origin"), null);
  });

  it("treats origins as exact matches (scheme and port matter)", async () => {
    for (const origin of ["https://localhost:5173", "http://localhost:5174"]) {
      const res = await fetch(`${server.baseUrl}/api/health`, { headers: { origin } });
      assert.equal(res.status, 403, origin);
    }
  });

  it("serves requests without an Origin header (non-browser clients) without CORS headers", async () => {
    const res = await fetch(`${server.baseUrl}/api/health`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), null);
  });
});

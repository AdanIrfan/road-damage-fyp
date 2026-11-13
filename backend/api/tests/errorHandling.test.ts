import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import express from "express";
import { createApp } from "../src/app.js";
import { createErrorHandler } from "../src/middleware/errorHandler.js";
import { HttpError } from "../src/utils/httpError.js";
import { startTestServer, type TestServer } from "./helpers/testServer.js";

describe("app-level error handling", () => {
  let server: TestServer;

  before(async () => {
    server = await startTestServer(
      createApp(
        { checkDatabase: async () => {} },
        { exposeErrorStack: false, logRequests: false, corsOrigins: ["http://localhost:5173"] },
      ),
    );
  });
  after(() => server.close());

  it("returns a JSON 404 for unknown versioned routes", async () => {
    const res = await fetch(`${server.baseUrl}/api/v1/reports`);
    assert.equal(res.status, 404);
    const body = (await res.json()) as { success: boolean; error: { code: string } };
    assert.deepEqual([body.success, body.error.code], [false, "NOT_FOUND"]);
  });

  it("returns a JSON 404 for unknown routes", async () => {
    const res = await fetch(`${server.baseUrl}/api/does-not-exist`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), {
      success: false,
      error: { code: "NOT_FOUND", message: "Route GET /api/does-not-exist not found" },
    });
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await fetch(`${server.baseUrl}/api/health`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ not json",
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "INVALID_JSON");
  });

  it("returns 413 for JSON bodies over the size limit", async () => {
    const res = await fetch(`${server.baseUrl}/api/health`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: "x".repeat(200 * 1024) }),
    });
    assert.equal(res.status, 413);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "PAYLOAD_TOO_LARGE");
  });
});

/** Small app that throws on purpose, to test the error handler on its own. */
function createThrowingApp(exposeStack: boolean, error: unknown): express.Express {
  const app = express();
  app.get("/boom", async () => {
    throw error;
  });
  app.use(createErrorHandler({ exposeStack }));
  return app;
}

describe("error handler", () => {
  it("hides internal error messages and stack traces when exposeStack is false", async (t) => {
    t.mock.method(console, "error", () => {});
    const server = await startTestServer(
      createThrowingApp(false, new Error("password authentication failed for user road_damage_user")),
    );
    try {
      const res = await fetch(`${server.baseUrl}/boom`);
      assert.equal(res.status, 500);
      const text = await res.text();
      assert.ok(!text.includes("password authentication failed"));
      assert.deepEqual(JSON.parse(text), {
        success: false,
        error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." },
      });
    } finally {
      await server.close();
    }
  });

  it("includes the stack trace only when exposeStack is true", async (t) => {
    t.mock.method(console, "error", () => {});
    const server = await startTestServer(createThrowingApp(true, new Error("boom")));
    try {
      const res = await fetch(`${server.baseUrl}/boom`);
      const body = (await res.json()) as { error: { message: string; stack?: string } };
      assert.equal(body.error.message, "An unexpected error occurred.");
      assert.ok(body.error.stack?.includes("Error: boom"));
    } finally {
      await server.close();
    }
  });

  it("never includes a stack trace for expected 4xx errors, even when exposeStack is true", async () => {
    const server = await startTestServer(createThrowingApp(true, new HttpError(409, "CONFLICT", "Already exists.")));
    try {
      const res = await fetch(`${server.baseUrl}/boom`);
      const body = (await res.json()) as { error: { stack?: string } };
      assert.equal(body.error.stack, undefined);
    } finally {
      await server.close();
    }
  });

  it("uses the status, code and message of an HttpError", async () => {
    const server = await startTestServer(createThrowingApp(false, new HttpError(409, "CONFLICT", "Already exists.")));
    try {
      const res = await fetch(`${server.baseUrl}/boom`);
      assert.equal(res.status, 409);
      assert.deepEqual(await res.json(), {
        success: false,
        error: { code: "CONFLICT", message: "Already exists." },
      });
    } finally {
      await server.close();
    }
  });
});

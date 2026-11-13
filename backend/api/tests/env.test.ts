import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EnvValidationError, parseEnv } from "../src/config/env.js";

const validUrl = "postgresql://user:test-password@localhost:5432/test_db?schema=public";

function problemsFor(source: NodeJS.ProcessEnv): readonly string[] {
  try {
    parseEnv(source);
  } catch (error) {
    assert.ok(error instanceof EnvValidationError);
    return error.problems;
  }
  assert.fail("expected parseEnv to throw");
}

describe("parseEnv", () => {
  it("parses valid configuration", () => {
    assert.deepEqual(
      parseEnv({ NODE_ENV: "production", PORT: "8080", DATABASE_URL: validUrl, CORS_ORIGIN: "https://app.example.com" }),
      { nodeEnv: "production", port: 8080, databaseUrl: validUrl, corsOrigins: ["https://app.example.com"] },
    );
  });

  it("defaults NODE_ENV to development and PORT to 3000", () => {
    const env = parseEnv({ DATABASE_URL: validUrl });
    assert.equal(env.nodeEnv, "development");
    assert.equal(env.port, 3000);
  });

  it("reports every invalid variable at once", () => {
    const problems = problemsFor({ NODE_ENV: "staging", PORT: "abc" });
    assert.equal(problems.length, 3);
  });

  it("rejects non-PostgreSQL URLs and the placeholder password", () => {
    assert.equal(problemsFor({ DATABASE_URL: "mysql://u:p@localhost/db" }).length, 1);
    const [problem] = problemsFor({
      DATABASE_URL: "postgresql://road_damage_user:YOUR_PASSWORD@localhost:5432/road_damage_db",
    });
    assert.match(problem ?? "", /placeholder/);
  });

  it("defaults CORS to the Vite dev server outside production", () => {
    assert.deepEqual(parseEnv({ DATABASE_URL: validUrl }).corsOrigins, ["http://localhost:5173"]);
    assert.deepEqual(parseEnv({ NODE_ENV: "test", DATABASE_URL: validUrl }).corsOrigins, ["http://localhost:5173"]);
  });

  it("requires CORS_ORIGIN in production", () => {
    for (const value of [undefined, "", "  ,  "]) {
      const problems = problemsFor({ NODE_ENV: "production", DATABASE_URL: validUrl, CORS_ORIGIN: value });
      assert.equal(problems.length, 1);
      assert.match(problems[0] ?? "", /CORS_ORIGIN is required/);
    }
  });

  it("parses comma-separated origins, trimming spaces, trailing slashes and duplicates", () => {
    const env = parseEnv({
      NODE_ENV: "production",
      DATABASE_URL: validUrl,
      CORS_ORIGIN: " https://app.example.com/ , http://localhost:5173,https://app.example.com ",
    });
    assert.deepEqual(env.corsOrigins, ["https://app.example.com", "http://localhost:5173"]);
  });

  it("rejects the * wildcard and entries that are not bare origins", () => {
    for (const value of ["*", "https://app.example.com/path", "ftp://files.example.com", "not a url"]) {
      const problems = problemsFor({ DATABASE_URL: validUrl, CORS_ORIGIN: value });
      assert.equal(problems.length, 1, value);
    }
  });

  it("never includes secret values in error messages", () => {
    const secretUrl = "mysql://user:super-secret-value@localhost/db";
    try {
      parseEnv({ DATABASE_URL: secretUrl, PORT: "99999" });
      assert.fail("expected parseEnv to throw");
    } catch (error) {
      assert.ok(error instanceof EnvValidationError);
      assert.ok(!error.message.includes("super-secret-value"));
    }
  });
});

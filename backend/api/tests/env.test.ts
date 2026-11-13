import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EnvValidationError, parseEnv } from "../src/config/env.js";
import { MockSmsSender } from "../src/services/sms/mockSmsSender.js";
import { createSmsSender } from "../src/services/sms/index.js";

const validUrl = "postgresql://user:test-password@localhost:5432/test_db?schema=public";
const authSecret = "a-test-secret-that-is-at-least-32-characters-long";
/** Minimal valid development configuration. */
const dev = { DATABASE_URL: validUrl, AUTH_SECRET: authSecret, SMS_PROVIDER: "mock" };

function problemsFor(source: NodeJS.ProcessEnv): readonly string[] {
  try {
    parseEnv(source);
  } catch (error) {
    assert.ok(error instanceof EnvValidationError);
    return error.problems;
  }
  assert.fail("expected parseEnv to throw");
}

function hasProblem(source: NodeJS.ProcessEnv, pattern: RegExp): boolean {
  return problemsFor(source).some((problem) => pattern.test(problem));
}

describe("parseEnv", () => {
  it("parses valid configuration", () => {
    assert.deepEqual(
      parseEnv({ ...dev, NODE_ENV: "development", PORT: "8080", CORS_ORIGIN: "https://app.example.com", PHONE_DEFAULT_COUNTRY: "us" }),
      {
        nodeEnv: "development",
        port: 8080,
        databaseUrl: validUrl,
        corsOrigins: ["https://app.example.com"],
        authSecret,
        smsProvider: "mock",
        phoneDefaultCountry: "US",
        cookieSameSite: "lax",
      },
    );
  });

  it("defaults NODE_ENV to development, PORT to 3000 and COOKIE_SAMESITE to lax", () => {
    const env = parseEnv(dev);
    assert.equal(env.nodeEnv, "development");
    assert.equal(env.port, 3000);
    assert.equal(env.cookieSameSite, "lax");
    assert.equal(env.phoneDefaultCountry, undefined);
  });

  it("reports every invalid variable at once", () => {
    const problems = problemsFor({ NODE_ENV: "staging", PORT: "abc" });
    for (const name of ["NODE_ENV", "PORT", "DATABASE_URL", "AUTH_SECRET"]) {
      assert.ok(problems.some((p) => p.startsWith(name)), name);
    }
  });

  it("rejects non-PostgreSQL URLs and the placeholder password", () => {
    assert.ok(hasProblem({ ...dev, DATABASE_URL: "mysql://u:p@localhost/db" }, /postgresql/));
    assert.ok(
      hasProblem({ ...dev, DATABASE_URL: "postgresql://road_damage_user:YOUR_PASSWORD@localhost:5432/road_damage_db" }, /placeholder/),
    );
  });

  it("defaults CORS to the Vite dev server outside production", () => {
    assert.deepEqual(parseEnv(dev).corsOrigins, ["http://localhost:5173"]);
    assert.deepEqual(parseEnv({ ...dev, NODE_ENV: "test", SMS_PROVIDER: "" }).corsOrigins, ["http://localhost:5173"]);
  });

  it("requires CORS_ORIGIN in production", () => {
    for (const value of [undefined, "", "  ,  "]) {
      assert.ok(hasProblem({ ...dev, NODE_ENV: "production", CORS_ORIGIN: value }, /CORS_ORIGIN is required/));
    }
  });

  it("parses comma-separated origins, trimming spaces, trailing slashes and duplicates", () => {
    const env = parseEnv({
      ...dev,
      CORS_ORIGIN: " https://app.example.com/ , http://localhost:5173,https://app.example.com ",
    });
    assert.deepEqual(env.corsOrigins, ["https://app.example.com", "http://localhost:5173"]);
  });

  it("rejects the * wildcard and entries that are not bare origins", () => {
    for (const value of ["*", "https://app.example.com/path", "ftp://files.example.com", "not a url"]) {
      assert.equal(problemsFor({ ...dev, CORS_ORIGIN: value }).length, 1, value);
    }
  });

  it("requires a long, non-placeholder AUTH_SECRET", () => {
    assert.ok(hasProblem({ ...dev, AUTH_SECRET: undefined }, /AUTH_SECRET is required/));
    assert.ok(hasProblem({ ...dev, AUTH_SECRET: "too-short" }, /at least 32/));
    assert.ok(hasProblem({ ...dev, AUTH_SECRET: "CHANGE_ME_CHANGE_ME_CHANGE_ME_CHANGE_ME" }, /placeholder/));
  });

  it("allows the mock SMS provider only in development and never in production", () => {
    assert.equal(parseEnv(dev).smsProvider, "mock");
    assert.ok(hasProblem({ ...dev, SMS_PROVIDER: undefined }, /SMS_PROVIDER is required/));
    assert.ok(hasProblem({ ...dev, NODE_ENV: "production", CORS_ORIGIN: "https://a.example.com" }, /only allowed when NODE_ENV=development/));
    assert.ok(
      hasProblem({ ...dev, NODE_ENV: "production", CORS_ORIGIN: "https://a.example.com", SMS_PROVIDER: undefined }, /no real SMS provider/),
    );
    assert.ok(hasProblem({ ...dev, SMS_PROVIDER: "twilio" }, /not implemented/));
    assert.equal(parseEnv({ ...dev, NODE_ENV: "test", SMS_PROVIDER: undefined }).smsProvider, undefined);
  });

  it("validates PHONE_DEFAULT_COUNTRY and COOKIE_SAMESITE", () => {
    assert.ok(hasProblem({ ...dev, PHONE_DEFAULT_COUNTRY: "XX" }, /PHONE_DEFAULT_COUNTRY/));
    assert.ok(hasProblem({ ...dev, COOKIE_SAMESITE: "sometimes" }, /COOKIE_SAMESITE must be one of/));
    assert.ok(hasProblem({ ...dev, COOKIE_SAMESITE: "none" }, /requires secure cookies/));
    assert.equal(parseEnv({ ...dev, COOKIE_SAMESITE: "Strict" }).cookieSameSite, "strict");
  });

  it("never includes secret values in error messages", () => {
    try {
      parseEnv({ DATABASE_URL: "mysql://user:super-secret-value@localhost/db", AUTH_SECRET: "short-secret-xyz", PORT: "99999" });
      assert.fail("expected parseEnv to throw");
    } catch (error) {
      assert.ok(error instanceof EnvValidationError);
      assert.ok(!error.message.includes("super-secret-value"));
      assert.ok(!error.message.includes("short-secret-xyz"));
    }
  });
});

describe("SMS sender selection", () => {
  it("refuses to create the mock sender outside development", () => {
    assert.throws(() => new MockSmsSender("production"));
    assert.throws(() => new MockSmsSender("test"));
    assert.throws(() => createSmsSender({ nodeEnv: "production", smsProvider: "mock" }));
    assert.throws(() => createSmsSender({ nodeEnv: "development", smsProvider: undefined }), /No SMS provider/);
    assert.equal(createSmsSender({ nodeEnv: "development", smsProvider: "mock" }).providerName, "mock");
  });
});

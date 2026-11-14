import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createPrismaClient, type PrismaClient } from "../../src/db/prisma.js";

/**
 * Database tests run in a SEPARATE schema of the configured database (default "app_test"),
 * never in "public". The app user cannot create databases, so a schema is the isolation unit.
 * Tables in this schema are truncated between tests.
 */
export const TEST_SCHEMA = process.env["TEST_DATABASE_SCHEMA"] ?? "app_test";

// Safety guard: refuse anything that does not look like a dedicated test schema.
if (!/^[a-z][a-z0-9_]*_test$/.test(TEST_SCHEMA)) {
  throw new Error(`TEST_DATABASE_SCHEMA must end with "_test" (got "${TEST_SCHEMA}")`);
}

function testDatabaseUrl(): string | undefined {
  const envFile = new URL("../../.env", import.meta.url);
  if (process.env["DATABASE_URL"] === undefined && existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
  const base = process.env["DATABASE_URL"];
  if (base === undefined || base === "") {
    return undefined;
  }
  const url = new URL(base);
  url.searchParams.set("schema", TEST_SCHEMA);
  return url.toString();
}

const url = testDatabaseUrl();

/** Pass to describe(..., { skip }) so database tests are clearly skipped without a database. */
export const skipWithoutDatabase: string | false =
  url === undefined ? "DATABASE_URL is not configured; database tests skipped" : false;

export interface TestDatabase {
  prisma: PrismaClient;
  /** Deletes all rows in the test schema. */
  reset: () => Promise<void>;
  close: () => Promise<void>;
}

/** Applies migrations to the test schema (non-destructive) and returns a client for it. */
export function setupTestDatabase(): TestDatabase {
  if (url === undefined) {
    throw new Error("DATABASE_URL is not configured");
  }
  execFileSync("npx", ["--no-install", "prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  const prisma = createPrismaClient(url);
  return {
    prisma,
    reset: async () => {
      await prisma.$executeRawUnsafe(
        `TRUNCATE TABLE "${TEST_SCHEMA}"."ai_detections", "${TEST_SCHEMA}"."report_images", "${TEST_SCHEMA}"."report_status_history", ` +
          `"${TEST_SCHEMA}"."reports", "${TEST_SCHEMA}"."refresh_tokens", "${TEST_SCHEMA}"."otp_codes", "${TEST_SCHEMA}"."users" CASCADE`,
      );
    },
    close: () => prisma.$disconnect(),
  };
}

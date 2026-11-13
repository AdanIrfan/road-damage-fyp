// Prisma CLI configuration (Prisma 7).
// Prisma 7 does not load .env automatically, so load it here with Node's
// built-in loader (no extra dependency). Existing environment variables win.
import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

const envFile = new URL("./.env", import.meta.url);
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Only commands that talk to the database need this. `prisma generate`
    // works without it, so a fresh clone can generate before .env exists.
    url: process.env["DATABASE_URL"] ?? "",
  },
});

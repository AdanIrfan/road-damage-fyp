/**
 * Resets the password of one existing account (admin, engineer or citizen).
 *
 *   npm run account:reset-password
 *   (compiled build: node dist/scripts/resetPassword.js)
 *
 * Asks for the account's mobile number, shows the account for confirmation, then asks for the
 * new password twice with hidden input. Only that account's password hash changes, and all of
 * its existing login sessions are signed out. Role, status, verification and data are untouched.
 * Passwords and hashes are never printed. Reads DATABASE_URL (and optional
 * PHONE_DEFAULT_COUNTRY) from backend/api/.env.
 */
import { isSupportedCountry } from "libphonenumber-js/max";
import { loadEnvFile } from "../config/env.js";
import { createPrismaClient } from "../db/prisma.js";
import { PasswordResetError } from "../services/passwordReset.service.js";
import { runAccountPasswordReset } from "./accountPasswordReset.js";
import { createTerminalPrompter, PromptError } from "./prompt.js";

async function main(): Promise<void> {
  loadEnvFile();
  const databaseUrl = process.env["DATABASE_URL"];
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new PasswordResetError("DATABASE_URL is not set (configure backend/api/.env).");
  }
  const rawCountry = process.env["PHONE_DEFAULT_COUNTRY"]?.trim().toUpperCase() ?? "";
  const defaultCountry = rawCountry !== "" && isSupportedCountry(rawCountry) ? rawCountry : undefined;
  // Only the schema name is shown (never the connection string), so it is clear which data is changed.
  const schema = new URL(databaseUrl).searchParams.get("schema") ?? "public";

  const prompt = createTerminalPrompter();
  const prisma = createPrismaClient(databaseUrl);
  try {
    console.log(`Reset an account password (database schema: ${schema})`);
    await runAccountPasswordReset({ prisma, prompt, print: (line) => console.log(line), defaultCountry });
  } finally {
    prompt.close();
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof PasswordResetError || error instanceof PromptError ? `Error: ${error.message}` : error);
  process.exitCode = 1;
});

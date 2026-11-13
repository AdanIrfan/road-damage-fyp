/**
 * Creates an admin account from the command line. There is NO public admin registration.
 *
 *   npm run admin:create                  # first admin (refuses if an admin already exists)
 *   npm run admin:create -- --additional  # another admin
 *
 * Asks for full name, mobile number and password (hidden). Nothing is hard-coded and the
 * password is never printed or stored anywhere except as an Argon2id hash.
 * Reads DATABASE_URL (and optional PHONE_DEFAULT_COUNTRY) from backend/api/.env.
 */
import { createInterface } from "node:readline";
import { isSupportedCountry } from "libphonenumber-js/max";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../config/auth.js";
import { loadEnvFile } from "../config/env.js";
import { createPrismaClient } from "../db/prisma.js";
import { AdminBootstrapError, createAdminAccount } from "../services/adminBootstrap.service.js";
import { normalizeMobileNumber } from "../utils/phone.js";

interface Prompter {
  /** Reads one line. When `hidden`, typed characters are not echoed. */
  ask: (question: string, hidden?: boolean) => Promise<string>;
  close: () => void;
}

/**
 * Interactive terminal: reads keystrokes in raw mode so hidden input is never echoed.
 * Piped input (non-TTY): reads lines in order through readline's buffered async iterator.
 */
function createPrompter(): Prompter {
  if (!process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, terminal: false });
    const lines = rl[Symbol.asyncIterator]();
    return {
      ask: async (question) => {
        process.stdout.write(question);
        const next = await lines.next();
        process.stdout.write("\n");
        if (next.done === true) {
          throw new AdminBootstrapError("Input ended before all questions were answered.");
        }
        return next.value;
      },
      close: () => rl.close(),
    };
  }

  const stdin = process.stdin;
  return {
    ask: (question, hidden = false) =>
      new Promise<string>((resolve, reject) => {
        process.stdout.write(question);
        let value = "";
        const finish = (): void => {
          stdin.off("data", onData);
          stdin.setRawMode(false);
          stdin.pause();
          process.stdout.write("\n");
        };
        const onData = (chunk: string): void => {
          for (const char of chunk) {
            if (char === "\r" || char === "\n") {
              finish();
              resolve(value);
              return;
            }
            if (char === "\u0003") {
              finish();
              reject(new AdminBootstrapError("Cancelled."));
              return;
            }
            if (char === "\u007f" || char === "\b") {
              if (value.length > 0) {
                value = value.slice(0, -1);
                if (!hidden) process.stdout.write("\b \b");
              }
              continue;
            }
            value += char;
            if (!hidden) process.stdout.write(char);
          }
        };
        stdin.setRawMode(true);
        stdin.setEncoding("utf8");
        stdin.resume();
        stdin.on("data", onData);
      }),
    close: () => undefined,
  };
}

async function main(): Promise<void> {
  loadEnvFile();
  const allowAdditional = process.argv.includes("--additional");
  const databaseUrl = process.env["DATABASE_URL"];
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new AdminBootstrapError("DATABASE_URL is not set (configure backend/api/.env).");
  }
  const rawCountry = process.env["PHONE_DEFAULT_COUNTRY"]?.trim().toUpperCase() ?? "";
  const defaultCountry = rawCountry !== "" && isSupportedCountry(rawCountry) ? rawCountry : undefined;

  const prompt = createPrompter();
  const prisma = createPrismaClient(databaseUrl);
  try {
    console.log(allowAdditional ? "Create an additional admin account" : "Create the first admin account");

    const fullName = (await prompt.ask("Full name: ")).trim();
    if (fullName.length < 2 || fullName.length > 100) {
      throw new AdminBootstrapError("Full name must be 2-100 characters.");
    }

    const mobileNumber = normalizeMobileNumber(await prompt.ask("Mobile number (with country code): "), defaultCountry);
    if (mobileNumber === undefined) {
      throw new AdminBootstrapError("That is not a valid mobile number.");
    }

    const password = await prompt.ask(`Password (${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters): `, true);
    if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
      throw new AdminBootstrapError(`Password must be ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters.`);
    }
    if ((await prompt.ask("Confirm password: ", true)) !== password) {
      throw new AdminBootstrapError("Passwords do not match.");
    }

    const admin = await createAdminAccount(prisma, { fullName, mobileNumber, password }, { allowAdditional });
    console.log(`Admin account created: ${admin.fullName} (${admin.mobileNumber}). You can now log in.`);
  } finally {
    prompt.close();
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof AdminBootstrapError ? `Error: ${error.message}` : error);
  process.exitCode = 1;
});

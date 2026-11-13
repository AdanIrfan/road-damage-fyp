import { existsSync } from "node:fs";
import { isSupportedCountry, type CountryCode } from "libphonenumber-js/max";

export type NodeEnv = "development" | "production" | "test";
export type CookieSameSite = "lax" | "strict" | "none";
/** SMS providers that are actually implemented. Only "mock" exists so far (development only). */
export type SmsProviderName = "mock";

export interface Env {
  nodeEnv: NodeEnv;
  port: number;
  databaseUrl: string;
  /** Browser origins allowed to call the API (CORS). Never contains "*". */
  corsOrigins: readonly string[];
  /** Master secret for JWT signing, OTP hashing and CSRF tokens (keys are derived from it). */
  authSecret: string;
  /** Undefined only in the test environment, where tests inject their own SMS sender. */
  smsProvider: SmsProviderName | undefined;
  /** ISO 3166 country used when a mobile number is entered without +country code. */
  phoneDefaultCountry: CountryCode | undefined;
  cookieSameSite: CookieSameSite;
}

const NODE_ENVS: readonly NodeEnv[] = ["development", "production", "test"];
const DEFAULT_PORT = "3000";
const PLACEHOLDER_PASSWORD = "YOUR_PASSWORD";
const PLACEHOLDER_SECRET = "CHANGE_ME";
const MIN_AUTH_SECRET_LENGTH = 32;
const COOKIE_SAME_SITE_VALUES: readonly CookieSameSite[] = ["lax", "strict", "none"];
/** Vite dev server. Used only outside production when CORS_ORIGIN is not set. */
const DEFAULT_DEV_CORS_ORIGINS: readonly string[] = ["http://localhost:5173"];

/** Thrown when environment variables are missing or invalid. Never contains secret values. */
export class EnvValidationError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Invalid environment configuration:\n  - ${problems.join("\n  - ")}`);
    this.name = "EnvValidationError";
    this.problems = problems;
  }
}

/**
 * Loads backend/api/.env into process.env if the file exists.
 * Variables that are already set (for example by the hosting platform) are not overwritten.
 * The path is resolved from this module, so it works from both src/ and dist/.
 */
export function loadEnvFile(): void {
  const envFile = new URL("../../.env", import.meta.url);
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
}

/** Validates raw environment variables and returns typed configuration. */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const problems: string[] = [];

  const rawNodeEnv = source["NODE_ENV"] ?? "development";
  const nodeEnv = NODE_ENVS.find((value) => value === rawNodeEnv);
  if (nodeEnv === undefined) {
    problems.push(`NODE_ENV must be one of: ${NODE_ENVS.join(", ")}`);
  }

  const rawPort = source["PORT"] ?? DEFAULT_PORT;
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || port < 1 || port > 65_535) {
    problems.push("PORT must be a whole number between 1 and 65535");
  }

  const databaseUrl = source["DATABASE_URL"];
  if (databaseUrl === undefined || databaseUrl.trim() === "") {
    problems.push("DATABASE_URL is required");
  } else if (!isPostgresUrl(databaseUrl)) {
    problems.push("DATABASE_URL must be a valid postgresql:// connection string");
  } else if (databaseUrl.includes(PLACEHOLDER_PASSWORD)) {
    problems.push(`DATABASE_URL still contains the placeholder ${PLACEHOLDER_PASSWORD}; put your real password in .env`);
  }

  const corsOrigins = parseCorsOrigins(source["CORS_ORIGIN"], nodeEnv, problems);

  const authSecret = source["AUTH_SECRET"] ?? "";
  if (authSecret === "") {
    problems.push("AUTH_SECRET is required (generate one with: openssl rand -base64 48)");
  } else if (authSecret.includes(PLACEHOLDER_SECRET)) {
    problems.push(`AUTH_SECRET still contains the placeholder ${PLACEHOLDER_SECRET}; generate a real secret`);
  } else if (authSecret.length < MIN_AUTH_SECRET_LENGTH) {
    problems.push(`AUTH_SECRET must be at least ${MIN_AUTH_SECRET_LENGTH} characters long`);
  }

  const smsProvider = parseSmsProvider(source["SMS_PROVIDER"], nodeEnv, problems);

  const rawCountry = source["PHONE_DEFAULT_COUNTRY"]?.trim().toUpperCase() ?? "";
  let phoneDefaultCountry: CountryCode | undefined;
  if (rawCountry !== "") {
    if (isSupportedCountry(rawCountry)) {
      phoneDefaultCountry = rawCountry;
    } else {
      problems.push("PHONE_DEFAULT_COUNTRY must be a two-letter ISO country code such as GB or US");
    }
  }

  const rawSameSite = (source["COOKIE_SAMESITE"] ?? "lax").trim().toLowerCase();
  const cookieSameSite = COOKIE_SAME_SITE_VALUES.find((value) => value === rawSameSite);
  if (cookieSameSite === undefined) {
    problems.push(`COOKIE_SAMESITE must be one of: ${COOKIE_SAME_SITE_VALUES.join(", ")}`);
  } else if (cookieSameSite === "none" && nodeEnv !== "production") {
    problems.push("COOKIE_SAMESITE=none requires secure cookies, which are only enabled when NODE_ENV=production");
  }

  if (problems.length > 0 || nodeEnv === undefined || databaseUrl === undefined || cookieSameSite === undefined) {
    throw new EnvValidationError(problems);
  }

  return { nodeEnv, port, databaseUrl, corsOrigins, authSecret, smsProvider, phoneDefaultCountry, cookieSameSite };
}

/**
 * SMS_PROVIDER selects how OTP messages are delivered.
 * - "mock" prints messages to the console instead of sending them. Allowed ONLY in development.
 * - No real provider is implemented yet, so production refuses to start rather than silently
 *   pretending to deliver SMS.
 * - In the test environment it may be unset (tests inject a fake sender).
 */
function parseSmsProvider(
  raw: string | undefined,
  nodeEnv: NodeEnv | undefined,
  problems: string[],
): SmsProviderName | undefined {
  const value = raw?.trim().toLowerCase() ?? "";
  if (value === "") {
    if (nodeEnv !== "test") {
      problems.push(
        nodeEnv === "production"
          ? "SMS_PROVIDER is required in production, but no real SMS provider is implemented yet"
          : "SMS_PROVIDER is required (use SMS_PROVIDER=mock in development)",
      );
    }
    return undefined;
  }
  if (value === "mock") {
    if (nodeEnv !== "development") {
      problems.push("SMS_PROVIDER=mock is only allowed when NODE_ENV=development");
    }
    return "mock";
  }
  problems.push(`SMS_PROVIDER "${value}" is not implemented (available: mock, development only)`);
  return undefined;
}

/**
 * CORS_ORIGIN is a comma-separated list of exact origins, e.g.
 * "https://app.example.com,https://admin.example.com".
 * Required in production; defaults to the Vite dev server otherwise. "*" is never accepted.
 */
function parseCorsOrigins(raw: string | undefined, nodeEnv: NodeEnv | undefined, problems: string[]): string[] {
  const entries = (raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");

  if (entries.length === 0) {
    if (nodeEnv === "production") {
      problems.push("CORS_ORIGIN is required when NODE_ENV=production (comma-separated list of allowed origins)");
      return [];
    }
    return [...DEFAULT_DEV_CORS_ORIGINS];
  }

  const origins: string[] = [];
  for (const entry of entries) {
    if (entry === "*") {
      problems.push('CORS_ORIGIN must list explicit origins; "*" is not allowed');
      continue;
    }
    const origin = toOrigin(entry);
    if (origin === undefined) {
      problems.push(`CORS_ORIGIN entry "${entry}" must be an origin such as https://example.com (no path)`);
      continue;
    }
    if (!origins.includes(origin)) {
      origins.push(origin);
    }
  }
  return origins;
}

/** Returns the normalized origin, or undefined if the entry is not a bare http(s) origin. */
function toOrigin(entry: string): string | undefined {
  try {
    const url = new URL(entry);
    const isHttp = url.protocol === "http:" || url.protocol === "https:";
    // Reject paths, queries and credentials: an origin is only scheme://host[:port].
    if (!isHttp || url.origin !== entry.replace(/\/$/, "").toLowerCase()) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

function isPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "postgresql:" || url.protocol === "postgres:";
  } catch {
    return false;
  }
}

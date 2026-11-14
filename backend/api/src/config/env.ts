import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
  /** Internal AI inference service. Undefined only in the test environment (tests inject a fake). */
  ai: AiServiceConfig | undefined;
  /** Absolute directory for uploaded images (never served directly). */
  uploadDir: string;
  /** Gallery uploads: EXIF position within this distance of the selected location counts as verified. */
  exifLocationToleranceKm: number;
  /** Live camera: browser GPS accuracy worse than this flags the report for admin review. */
  gpsAccuracyThresholdMeters: number;
}

export interface AiServiceConfig {
  /** Base URL, e.g. http://127.0.0.1:8000. Never sent to the frontend. */
  url: string;
  /** Shared secret sent in the X-AI-Service-Key header. Never logged or sent to the frontend. */
  secret: string;
  timeoutMs: number;
}

const NODE_ENVS: readonly NodeEnv[] = ["development", "production", "test"];
const DEFAULT_PORT = "3000";
const PLACEHOLDER_PASSWORD = "YOUR_PASSWORD";
const PLACEHOLDER_SECRET = "CHANGE_ME";
const MIN_AUTH_SECRET_LENGTH = 32;
const MIN_AI_SECRET_LENGTH = 32;
const DEFAULT_AI_TIMEOUT_MS = 30_000;
const DEFAULT_UPLOAD_DIR = "storage/uploads";
const DEFAULT_EXIF_TOLERANCE_KM = 2;
const DEFAULT_GPS_ACCURACY_THRESHOLD_M = 100;
/** backend/api/ — relative UPLOAD_DIR values are resolved from here (works from src/ and dist/). */
const API_ROOT = fileURLToPath(new URL("../../", import.meta.url));
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

  const ai = parseAiService(source, nodeEnv, problems);

  const rawUploadDir = source["UPLOAD_DIR"]?.trim() || DEFAULT_UPLOAD_DIR;
  const uploadDir = isAbsolute(rawUploadDir) ? rawUploadDir : resolve(API_ROOT, rawUploadDir);

  const exifLocationToleranceKm = parsePositiveNumber(
    source["EXIF_LOCATION_TOLERANCE_KM"],
    DEFAULT_EXIF_TOLERANCE_KM,
    "EXIF_LOCATION_TOLERANCE_KM must be a positive number of kilometres",
    problems,
  );
  const gpsAccuracyThresholdMeters = parsePositiveNumber(
    source["GPS_ACCURACY_THRESHOLD_METERS"],
    DEFAULT_GPS_ACCURACY_THRESHOLD_M,
    "GPS_ACCURACY_THRESHOLD_METERS must be a positive number of metres",
    problems,
  );

  if (problems.length > 0 || nodeEnv === undefined || databaseUrl === undefined || cookieSameSite === undefined) {
    throw new EnvValidationError(problems);
  }

  return {
    nodeEnv,
    port,
    databaseUrl,
    corsOrigins,
    authSecret,
    smsProvider,
    phoneDefaultCountry,
    cookieSameSite,
    ai,
    uploadDir,
    exifLocationToleranceKm,
    gpsAccuracyThresholdMeters,
  };
}

/**
 * AI_SERVICE_URL, AI_SERVICE_SECRET and AI_REQUEST_TIMEOUT_MS.
 * Required outside the test environment. Values are never included in error messages.
 */
function parseAiService(
  source: NodeJS.ProcessEnv,
  nodeEnv: NodeEnv | undefined,
  problems: string[],
): AiServiceConfig | undefined {
  const rawUrl = source["AI_SERVICE_URL"]?.trim() ?? "";
  const secret = source["AI_SERVICE_SECRET"] ?? "";
  const timeoutMs = parsePositiveNumber(
    source["AI_REQUEST_TIMEOUT_MS"],
    DEFAULT_AI_TIMEOUT_MS,
    "AI_REQUEST_TIMEOUT_MS must be a positive whole number of milliseconds",
    problems,
    true,
  );

  if (rawUrl === "" && secret === "" && nodeEnv === "test") {
    return undefined;
  }

  let url: string | undefined;
  if (rawUrl === "") {
    problems.push("AI_SERVICE_URL is required (for example http://127.0.0.1:8000)");
  } else if (!isHttpUrl(rawUrl)) {
    problems.push("AI_SERVICE_URL must be an http:// or https:// URL");
  } else {
    url = rawUrl.replace(/\/+$/, "");
  }

  if (secret === "") {
    problems.push("AI_SERVICE_SECRET is required (the same value as AI_SHARED_SECRET in backend/ai/.env)");
  } else if (secret.includes(PLACEHOLDER_SECRET)) {
    problems.push(`AI_SERVICE_SECRET still contains the placeholder ${PLACEHOLDER_SECRET}; generate a real secret`);
  } else if (secret.length < MIN_AI_SECRET_LENGTH) {
    problems.push(`AI_SERVICE_SECRET must be at least ${MIN_AI_SECRET_LENGTH} characters long`);
  }

  return url === undefined ? undefined : { url, secret, timeoutMs };
}

function parsePositiveNumber(
  raw: string | undefined,
  fallback: number,
  message: string,
  problems: string[],
  integer = false,
): number {
  const value = raw?.trim() ?? "";
  if (value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!/^\d+(\.\d+)?$/.test(value) || !(parsed > 0) || (integer && !Number.isInteger(parsed))) {
    problems.push(message);
    return fallback;
  }
  return parsed;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.username === "" && url.password === "";
  } catch {
    return false;
  }
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

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Structured logging (Phase 6). One JSON object per line:
 *
 *   {"time":"...","level":"info","event":"http_request","requestId":"...","method":"GET",...}
 *
 * - `event` is a stable snake_case name; details go in fields, not in the message text.
 * - `requestId` is added automatically for everything logged while a request is being handled.
 * - Fields whose names look sensitive are replaced by "[redacted]" (see SENSITIVE_KEY), and mobile
 *   numbers must be passed through maskMobileNumber() by the caller. Never log request bodies,
 *   coordinates, image data, cookies or tokens.
 *
 * Deliberately not routed through here: the development-only mock SMS sender (its whole purpose
 * is to print the code a developer needs) and the CLI scripts (they talk to a person).
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE_KEY = /pass(word)?|secret|token|otp|authorization|cookie|hash|csrf|api[-_]?key/i;
const MAX_DEPTH = 4;
const MAX_STRING = 2000;

const requestContext = new AsyncLocalStorage<{ requestId: string }>();

/** Runs `fn` (and everything it awaits) with a request id attached to its log lines. */
export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return requestContext.run({ requestId }, fn);
}

export function currentRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}

function describeError(error: Error, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = { name: error.name, message: error.message.slice(0, MAX_STRING) };
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string") out["code"] = code;
  if (error.stack !== undefined) out["stack"] = error.stack.slice(0, 4000);
  if (error.cause !== undefined && depth < MAX_DEPTH) out["cause"] = sanitize(error.cause, depth + 1);
  return out;
}

/** Makes any value safe to print: redacts sensitive keys, bounds depth and length, handles errors. */
export function sanitize(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return describeError(value, depth);
  if (Buffer.isBuffer(value)) return `[binary ${value.length} bytes]`;
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : sanitize(item, depth + 1);
    }
    return out;
  }
  return String(value);
}

export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

/** `write` is injectable so tests can capture lines. */
export function createLogger(options: { minLevel?: LogLevel; write?: (level: LogLevel, line: string) => void } = {}): Logger {
  const minLevel = options.minLevel ?? "info";
  const write =
    options.write ??
    ((level: LogLevel, line: string) => {
      // warn and error go to stderr so they can be separated from normal output.
      (level === "warn" || level === "error" ? process.stderr : process.stdout).write(`${line}\n`);
    });
  const log = (level: LogLevel, event: string, fields?: Record<string, unknown>): void => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
    const requestId = currentRequestId();
    const entry = {
      time: new Date().toISOString(),
      level,
      event,
      ...(requestId === undefined ? {} : { requestId }),
      ...((fields === undefined ? {} : sanitize(fields)) as Record<string, unknown>),
    };
    write(level, JSON.stringify(entry));
  };
  return {
    debug: (event, fields) => log("debug", event, fields),
    info: (event, fields) => log("info", event, fields),
    warn: (event, fields) => log("warn", event, fields),
    error: (event, fields) => log("error", event, fields),
  };
}

/** The process-wide logger. */
export const logger: Logger = createLogger();

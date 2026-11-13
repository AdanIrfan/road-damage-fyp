/**
 * The single HTTP client for the main backend.
 *
 * - Authentication uses httpOnly cookies set by the backend. Tokens are never visible to
 *   JavaScript and are never stored in localStorage.
 * - State-changing requests send the CSRF token (kept in memory) in X-CSRF-Token.
 * - On 401 the client tries one silent session refresh and retries the request once.
 */

const API_BASE_URL: string = (import.meta.env["VITE_API_BASE_URL"] as string | undefined) ?? "";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
/** Auth endpoints that must never trigger an automatic refresh. */
const NO_REFRESH_PATHS = ["/api/v1/auth/login", "/api/v1/auth/refresh", "/api/v1/auth/logout", "/api/v1/auth/register", "/api/v1/auth/otp"];

export type FieldErrors = Record<string, string[] | undefined>;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Per-field validation messages, if the server sent any. */
  get fieldErrors(): FieldErrors {
    const fields = this.details?.["fields"];
    return typeof fields === "object" && fields !== null ? (fields as FieldErrors) : {};
  }
}

interface ErrorBody {
  success: false;
  error: { code: string; message: string; details?: Record<string, unknown> };
}
interface SuccessBody<T> {
  success: true;
  data: T;
}

let csrfToken: string | undefined;
let csrfRequest: Promise<string> | undefined;
let refreshRequest: Promise<boolean> | undefined;
const sessionEndedListeners = new Set<() => void>();

/** Called when the session ends unexpectedly (refresh failed), so the UI can log out. */
export function onSessionEnded(listener: () => void): () => void {
  sessionEndedListeners.add(listener);
  return () => sessionEndedListeners.delete(listener);
}

async function send(method: string, path: string, body: unknown, csrf: string | undefined): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (csrf !== undefined) {
    headers["X-CSRF-Token"] = csrf;
  }
  try {
    return await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      credentials: "include",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Cannot reach the server. Check your connection and try again.");
  }
}

async function parse<T>(response: Response): Promise<T> {
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new ApiError(response.status, "INVALID_RESPONSE", "The server returned an unexpected response.");
  }
  if (response.ok && typeof json === "object" && json !== null && (json as SuccessBody<T>).success) {
    return (json as SuccessBody<T>).data;
  }
  const error = (json as Partial<ErrorBody>).error;
  throw new ApiError(
    response.status,
    error?.code ?? "UNKNOWN_ERROR",
    error?.message ?? "Something went wrong. Please try again.",
    error?.details,
  );
}

async function getCsrfToken(): Promise<string> {
  if (csrfToken !== undefined) {
    return csrfToken;
  }
  csrfRequest ??= send("GET", "/api/v1/auth/csrf", undefined, undefined)
    .then((response) => parse<{ csrfToken: string }>(response))
    .then((data) => {
      csrfToken = data.csrfToken;
      return data.csrfToken;
    })
    .finally(() => {
      csrfRequest = undefined;
    });
  return csrfRequest;
}

/** Refreshes the session once; concurrent callers share the same attempt (refresh tokens are single-use). */
export function refreshSession(): Promise<boolean> {
  refreshRequest ??= (async () => {
    try {
      const response = await send("POST", "/api/v1/auth/refresh", {}, await getCsrfToken());
      await parse<unknown>(response);
      return true;
    } catch {
      return false;
    }
  })().finally(() => {
    refreshRequest = undefined;
  });
  return refreshRequest;
}

export async function apiRequest<T>(method: string, path: string, body?: unknown, attempt = 0): Promise<T> {
  const unsafe = !SAFE_METHODS.has(method);
  const response = await send(method, path, unsafe ? (body ?? {}) : undefined, unsafe ? await getCsrfToken() : undefined);
  try {
    return await parse<T>(response);
  } catch (error) {
    if (!(error instanceof ApiError) || attempt > 0) {
      throw error;
    }
    if (error.code === "CSRF_TOKEN_INVALID") {
      csrfToken = undefined;
      return apiRequest<T>(method, path, body, attempt + 1);
    }
    const canRefresh = !NO_REFRESH_PATHS.some((prefix) => path.startsWith(prefix));
    if (error.status === 401 && canRefresh && (error.code === "TOKEN_EXPIRED" || error.code === "UNAUTHENTICATED")) {
      if (await refreshSession()) {
        return apiRequest<T>(method, path, body, attempt + 1);
      }
      sessionEndedListeners.forEach((listener) => listener());
    }
    throw error;
  }
}

export const api = {
  get: <T>(path: string) => apiRequest<T>("GET", path),
  post: <T>(path: string, body?: unknown) => apiRequest<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>("PATCH", path, body),
};

/** Friendly message for any thrown value. */
export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}

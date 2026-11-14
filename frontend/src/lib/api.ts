/**
 * The single HTTP client for the main backend.
 *
 * - Authentication uses httpOnly cookies set by the backend. Tokens are never visible to
 *   JavaScript and are never stored in localStorage.
 * - State-changing requests send the CSRF token (kept in memory) in X-CSRF-Token.
 * - On 401 the client tries one silent session refresh and retries the request once.
 * - Bodies are JSON, or multipart FormData for uploads (the browser sets the boundary).
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

async function send(method: string, path: string, body: unknown, csrf: string | undefined, accept = "application/json"): Promise<Response> {
  const headers: Record<string, string> = { Accept: accept };
  const isForm = body instanceof FormData;
  if (body !== undefined && !isForm) {
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
      ...(body === undefined ? {} : { body: isForm ? body : JSON.stringify(body) }),
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

/** Name of the browser-wide lock that serialises session refreshes across tabs. */
const REFRESH_LOCK = "road-damage-session-refresh";

/**
 * Refreshes the session once; concurrent callers in this tab share the same attempt.
 *
 * Refresh tokens are single-use and the server treats a reused one as theft (it revokes the whole
 * session). All tabs share the same cookies, so two tabs refreshing at the same moment would send
 * the same token and log the user out everywhere. A Web Lock makes tabs refresh one at a time, and
 * a tab that had to wait first checks whether the other tab's refresh already renewed the session.
 */
export function refreshSession(): Promise<boolean> {
  refreshRequest ??= withRefreshLock(async (waitedForAnotherTab) => {
    try {
      if (waitedForAnotherTab && (await sessionIsValid())) {
        return true;
      }
      const response = await send("POST", "/api/v1/auth/refresh", {}, await getCsrfToken());
      await parse<unknown>(response);
      return true;
    } catch {
      return false;
    }
  }).finally(() => {
    refreshRequest = undefined;
  });
  return refreshRequest;
}

async function withRefreshLock(task: (waitedForAnotherTab: boolean) => Promise<boolean>): Promise<boolean> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (locks === undefined) {
    // Very old browsers: no cross-tab coordination, same behaviour as before.
    return task(false);
  }
  const immediate = await locks.request(REFRESH_LOCK, { ifAvailable: true }, (lock) => (lock === null ? undefined : task(false)));
  if (immediate !== undefined) {
    return immediate;
  }
  // Another tab is refreshing right now: wait for it, then re-check before refreshing ourselves.
  return locks.request(REFRESH_LOCK, () => task(true));
}

/** True if the current cookies already carry a valid session (e.g. renewed by another tab). */
async function sessionIsValid(): Promise<boolean> {
  try {
    return (await send("GET", "/api/v1/auth/me", undefined, undefined)).ok;
  } catch {
    return false;
  }
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
  /** multipart/form-data upload (CSRF token and session refresh handled like any POST). */
  postForm: <T>(path: string, form: FormData) => apiRequest<T>("POST", path, form),
};

/**
 * Downloads a protected binary resource (e.g. a report photo) with the session cookie and
 * returns it as a Blob. Refreshes the session once on 401, like apiRequest.
 */
export async function apiBlob(path: string, attempt = 0): Promise<Blob> {
  const response = await send("GET", path, undefined, undefined, "image/*");
  if (response.ok) {
    return response.blob();
  }
  if (response.status === 401 && attempt === 0) {
    if (await refreshSession()) {
      return apiBlob(path, attempt + 1);
    }
    sessionEndedListeners.forEach((listener) => listener());
  }
  // parse() throws the server's ApiError (e.g. 404 IMAGE_NOT_FOUND) for error responses.
  await parse<unknown>(response);
  throw new ApiError(response.status, "UNKNOWN_ERROR", "The image could not be loaded.");
}

/** Friendly message for any thrown value. */
export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}

import cors from "cors";
import type { RequestHandler } from "express";
import { HttpError } from "../utils/httpError.js";

/** How long browsers may cache a preflight result (seconds). */
const PREFLIGHT_MAX_AGE_SECONDS = 600;

/**
 * Allows only the configured browser origins.
 *
 * - Allowed origin: CORS headers are sent (the origin is echoed back, never "*").
 * - Disallowed origin: the request is rejected with 403 before reaching any route,
 *   including preflight OPTIONS requests.
 * - No Origin header (curl, server-to-server, same-origin GET): passed through without
 *   CORS headers. CORS is a browser protection; authentication protects the API itself.
 */
export function createCorsMiddleware(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);

  return cors({
    origin: (origin, callback) => {
      if (origin === undefined) {
        callback(null, false);
      } else if (allowed.has(origin)) {
        callback(null, origin);
      } else {
        callback(new HttpError(403, "CORS_ORIGIN_NOT_ALLOWED", "This origin is not allowed to access the API."));
      }
    },
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
    // X-CSRF-Token carries the CSRF token for state-changing requests (see middleware/csrf.ts).
    // Authorization is kept for possible non-browser clients; the web app uses cookies.
    allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
    // Required: authentication uses httpOnly cookies. Safe because origins are an explicit list.
    credentials: true,
    maxAge: PREFLIGHT_MAX_AGE_SECONDS,
  });
}

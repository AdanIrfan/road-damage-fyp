import type { RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { HttpError } from "../utils/httpError.js";

export interface AuthRateLimiters {
  login: RequestHandler;
  register: RequestHandler;
  otp: RequestHandler;
}

const passThrough: RequestHandler = (_req, _res, next) => next();

function limiter(windowMinutes: number, limit: number): RequestHandler {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      next(new HttpError(429, "TOO_MANY_REQUESTS", "Too many attempts. Please wait and try again."));
    },
  });
}

/**
 * Per-IP limits for the unauthenticated auth endpoints (in-memory: one server process).
 * Disabled in tests. OTP codes additionally have per-account limits in the OTP service.
 */
export function createAuthRateLimiters(enabled: boolean): AuthRateLimiters {
  if (!enabled) {
    return { login: passThrough, register: passThrough, otp: passThrough };
  }
  return {
    login: limiter(15, 10),
    register: limiter(60, 10),
    otp: limiter(15, 20),
  };
}

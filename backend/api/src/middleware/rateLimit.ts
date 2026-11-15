import type { RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { REPORT_RATE_LIMIT } from "../config/reports.js";
import { REPAIR_PHOTO_RATE_LIMIT } from "../config/workflow.js";
import { HttpError } from "../utils/httpError.js";
import { getAuthUser } from "./auth.js";

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

/**
 * Per-user limit (keyed by user id, not IP, so people behind one network do not share a limit).
 * In memory, like the auth limiters. Must run after `authenticate`.
 */
function perUserLimiter(enabled: boolean, settings: { windowMinutes: number; limit: number }, message: string): RequestHandler {
  if (!enabled) {
    return passThrough;
  }
  return rateLimit({
    windowMs: settings.windowMinutes * 60 * 1000,
    limit: settings.limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => `user:${getAuthUser(req).id}`,
    handler: (_req, _res, next) => {
      next(new HttpError(429, "TOO_MANY_REQUESTS", message));
    },
  });
}

/** Report submissions per citizen. */
export function createReportRateLimiter(enabled: boolean): RequestHandler {
  return perUserLimiter(enabled, REPORT_RATE_LIMIT, "You have submitted many reports recently. Please wait and try again.");
}

/** Repair photo uploads per engineer. */
export function createRepairPhotoRateLimiter(enabled: boolean): RequestHandler {
  return perUserLimiter(enabled, REPAIR_PHOTO_RATE_LIMIT, "You have uploaded many photos recently. Please wait and try again.");
}

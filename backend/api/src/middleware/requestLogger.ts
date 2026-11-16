import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { logger, runWithRequestId } from "../utils/logger.js";

/** Header that carries the correlation id, on the response and (optionally) on the request. */
export const REQUEST_ID_HEADER = "X-Request-Id";
/** Only a well-formed id from the client (or a proxy) is reused; anything else is replaced. */
const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Gives every request a correlation id, returns it in the X-Request-Id response header, and makes
 * it available to every log line written while the request is handled. Always on (tests too).
 */
export const requestContext: RequestHandler = (req, res, next) => {
  const incoming = req.get(REQUEST_ID_HEADER);
  const requestId = incoming !== undefined && CLIENT_ID_PATTERN.test(incoming) ? incoming : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, requestId);
  runWithRequestId(requestId, next);
};

/**
 * One line per finished request: method, path, status, duration and who made it (user id and
 * role only). The query string is left out so search text, tokens or personal data in URLs are
 * never logged; bodies, cookies and headers are never logged either.
 */
export const requestLogger: RequestHandler = (req, res, next) => {
  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const path = req.originalUrl.split("?")[0] ?? req.originalUrl;
    const user = req.auth?.user;
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    logger[level]("http_request", {
      method: req.method,
      path,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
      ...(user === undefined ? {} : { userId: user.id, role: user.role }),
    });
  });

  next();
};

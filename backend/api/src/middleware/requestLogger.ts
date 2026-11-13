import type { RequestHandler } from "express";

/**
 * Minimal development request logger: method, path, status and duration.
 * The query string is deliberately left out so tokens or personal data in URLs are not logged.
 */
export const requestLogger: RequestHandler = (req, res, next) => {
  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const path = req.originalUrl.split("?")[0] ?? req.originalUrl;
    console.log(`${req.method} ${path} ${res.statusCode} ${durationMs.toFixed(1)}ms`);
  });

  next();
};

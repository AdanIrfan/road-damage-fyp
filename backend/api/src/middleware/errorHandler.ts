import type { ErrorRequestHandler } from "express";
import type { ApiErrorDetails } from "../types/api.js";
import { sendError } from "../utils/apiResponse.js";
import { HttpError } from "../utils/httpError.js";

export interface ErrorHandlerOptions {
  /** Include stack traces in 5xx responses. Must only be true in development. */
  exposeStack: boolean;
}

interface NormalizedError {
  statusCode: number;
  code: string;
  message: string;
}

const INTERNAL_ERROR: NormalizedError = {
  statusCode: 500,
  code: "INTERNAL_ERROR",
  message: "An unexpected error occurred.",
};

/** Central error handler. Must be registered after all routes. */
export function createErrorHandler(options: ErrorHandlerOptions): ErrorRequestHandler {
  return (err: unknown, _req, res, next) => {
    // If the response has already started, let Express close the connection.
    if (res.headersSent) {
      next(err);
      return;
    }

    const normalized = normalizeError(err);

    // Log server errors in full on the server; clients only get the safe message.
    if (normalized.statusCode >= 500) {
      console.error(err);
    }

    const details: ApiErrorDetails = { code: normalized.code, message: normalized.message };
    // Stacks only help with unexpected (5xx) errors; expected 4xx errors never include one.
    if (options.exposeStack && normalized.statusCode >= 500 && err instanceof Error && err.stack !== undefined) {
      details.stack = err.stack;
    }

    sendError(res, normalized.statusCode, details);
  };
}

function normalizeError(err: unknown): NormalizedError {
  if (err instanceof HttpError) {
    return { statusCode: err.statusCode, code: err.code, message: err.message };
  }

  // Errors raised by express.json() (body-parser) carry a `type` and `status`.
  const bodyParserType = getStringProperty(err, "type");
  if (bodyParserType === "entity.parse.failed") {
    return { statusCode: 400, code: "INVALID_JSON", message: "Request body contains invalid JSON." };
  }
  if (bodyParserType === "entity.too.large") {
    return { statusCode: 413, code: "PAYLOAD_TOO_LARGE", message: "Request body is too large." };
  }

  const status = getNumberProperty(err, "status");
  if (status !== undefined && status >= 400 && status < 500) {
    return { statusCode: status, code: "BAD_REQUEST", message: "The request could not be processed." };
  }

  return INTERNAL_ERROR;
}

function getStringProperty(value: unknown, key: string): string | undefined {
  if (typeof value === "object" && value !== null && key in value) {
    const property: unknown = (value as Record<string, unknown>)[key];
    return typeof property === "string" ? property : undefined;
  }
  return undefined;
}

function getNumberProperty(value: unknown, key: string): number | undefined {
  if (typeof value === "object" && value !== null && key in value) {
    const property: unknown = (value as Record<string, unknown>)[key];
    return typeof property === "number" ? property : undefined;
  }
  return undefined;
}

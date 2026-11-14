import type { RequestHandler } from "express";
import multer from "multer";
import { MAX_UPLOAD_BYTES } from "../config/reports.js";
import { HttpError } from "../utils/httpError.js";

/** Name of the multipart file field that carries the report photo. */
export const REPORT_IMAGE_FIELD = "image";

/**
 * Parses a multipart report submission: exactly one photo (kept in memory, at most
 * MAX_UPLOAD_BYTES) plus a few short text fields. Must run AFTER authentication, the role check,
 * CSRF protection and rate limiting, so anonymous or forged requests never get their body parsed.
 * The client's file name and MIME type are ignored later; the content is checked instead.
 */
const parseReportUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
    fields: 8,
    parts: 9,
    fieldNameSize: 50,
    fieldSize: 4 * 1024,
  },
}).single(REPORT_IMAGE_FIELD);

export const uploadReportImage: RequestHandler = (req, res, next) => {
  if (!req.is("multipart/form-data")) {
    next(new HttpError(400, "MULTIPART_REQUIRED", "Send the report as multipart/form-data."));
    return;
  }
  parseReportUpload(req, res, (error: unknown) => {
    next(error === undefined || error === null ? undefined : toHttpError(error));
  });
};

function toHttpError(error: unknown): HttpError {
  if (error instanceof multer.MulterError) {
    switch (error.code) {
      case "LIMIT_FILE_SIZE":
        return new HttpError(413, "FILE_TOO_LARGE", `The photo is too large. The maximum size is ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`, { cause: error });
      case "LIMIT_UNEXPECTED_FILE":
      case "LIMIT_FILE_COUNT":
        return new HttpError(400, "UNEXPECTED_FIELD", `Send exactly one photo in the "${REPORT_IMAGE_FIELD}" field.`, { cause: error });
      default:
        return new HttpError(400, "INVALID_MULTIPART", "The form data is invalid or has too many fields.", { cause: error });
    }
  }
  // busboy errors for malformed bodies (e.g. a broken boundary).
  return new HttpError(400, "INVALID_MULTIPART", "The form data is invalid.", { cause: error });
}

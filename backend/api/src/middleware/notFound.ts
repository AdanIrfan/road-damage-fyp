import type { RequestHandler } from "express";
import { HttpError } from "../utils/httpError.js";

/** Runs when no route matched. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new HttpError(404, "NOT_FOUND", `Route ${req.method} ${req.path} not found`));
};

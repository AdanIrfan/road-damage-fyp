import type { Response } from "express";
import type { ApiErrorDetails, ApiErrorResponse, ApiSuccessResponse } from "../types/api.js";

export function sendSuccess<T>(res: Response, data: T, statusCode = 200): void {
  const body: ApiSuccessResponse<T> = { success: true, data };
  res.status(statusCode).json(body);
}

export function sendError(res: Response, statusCode: number, error: ApiErrorDetails): void {
  const body: ApiErrorResponse = { success: false, error };
  res.status(statusCode).json(body);
}

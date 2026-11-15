import type { RequestHandler } from "express";
import type { AnalyticsService } from "../services/analytics.service.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { parseInput } from "../utils/validation.js";
import { analyticsQuerySchema } from "../validation/schemas.js";

/** ADMIN only (enforced by the router). */
export function createAnalyticsController(deps: { analytics: AnalyticsService }): { get: RequestHandler } {
  return {
    get: async (req, res) => {
      sendSuccess(res, { analytics: await deps.analytics.get(parseInput(analyticsQuerySchema, req.query)) });
    },
  };
}

import type { RequestHandler } from "express";
import { getAuthUser } from "../middleware/auth.js";
import type { ReportService } from "../services/report.service.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { HttpError } from "../utils/httpError.js";
import { parseInput } from "../utils/validation.js";
import {
  createReportSchema,
  listReportsQuerySchema,
  reportIdParamsSchema,
  reportImageParamsSchema,
} from "../validation/schemas.js";

export interface ReportsController {
  create: RequestHandler;
  list: RequestHandler;
  summary: RequestHandler;
  get: RequestHandler;
  image: RequestHandler;
}

/** Roles are enforced by the router; ownership by the service. */
export function createReportsController(deps: { reports: ReportService }): ReportsController {
  const { reports } = deps;

  return {
    create: async (req, res) => {
      const input = parseInput(createReportSchema, req.body);
      if (req.file === undefined) {
        throw new HttpError(400, "IMAGE_REQUIRED", "Add a photo of the road damage.");
      }
      const report = await reports.create(getAuthUser(req).id, input, req.file.buffer);
      sendSuccess(res, { report }, 201);
    },

    list: async (req, res) => {
      const query = parseInput(listReportsQuerySchema, req.query);
      sendSuccess(res, await reports.listForCitizen(getAuthUser(req).id, query));
    },

    summary: async (req, res) => {
      sendSuccess(res, { summary: await reports.summaryForCitizen(getAuthUser(req).id) });
    },

    get: async (req, res) => {
      const { id } = parseInput(reportIdParamsSchema, req.params);
      sendSuccess(res, { report: await reports.getForCitizen(getAuthUser(req).id, id) });
    },

    image: async (req, res) => {
      const { id, imageId } = parseInput(reportImageParamsSchema, req.params);
      const data = await reports.getImage(getAuthUser(req), id, imageId);
      res.set({
        "Content-Type": "image/jpeg",
        // Personal data: never cache in shared caches, and do not keep it in the browser cache.
        "Cache-Control": "private, no-store",
        "Content-Disposition": "inline",
      });
      res.send(data);
    },
  };
}

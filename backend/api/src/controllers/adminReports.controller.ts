import type { RequestHandler } from "express";
import { getAuthUser } from "../middleware/auth.js";
import type { AdminReportService } from "../services/adminReport.service.js";
import type { AssignmentService } from "../services/assignment.service.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { parseInput } from "../utils/validation.js";
import {
  assignEngineerSchema,
  confirmCompletionSchema,
  decisionSchema,
  feedbackSchema,
  listAdminReportsQuerySchema,
  reportIdParamsSchema,
  severitySchema,
} from "../validation/schemas.js";

export interface AdminReportsController {
  dashboard: RequestHandler;
  list: RequestHandler;
  map: RequestHandler;
  get: RequestHandler;
  review: RequestHandler;
  decide: RequestHandler;
  setSeverity: RequestHandler;
  feedback: RequestHandler;
  confirmCompletion: RequestHandler;
  suggestions: RequestHandler;
  possibleDuplicates: RequestHandler;
  retryAnalysis: RequestHandler;
  assign: RequestHandler;
}

/** ADMIN only (enforced by the router). Every state change is validated again in the service. */
export function createAdminReportsController(deps: { reports: AdminReportService; assignments: AssignmentService }): AdminReportsController {
  const { reports, assignments } = deps;
  const id = (params: unknown): string => parseInput(reportIdParamsSchema, params).id;

  return {
    dashboard: async (_req, res) => {
      sendSuccess(res, { dashboard: await reports.dashboard() });
    },

    map: async (req, res) => {
      sendSuccess(res, await reports.mapPoints(parseInput(listAdminReportsQuerySchema, req.query)));
    },

    possibleDuplicates: async (req, res) => {
      sendSuccess(res, await reports.possibleDuplicates(id(req.params)));
    },

    retryAnalysis: async (req, res) => {
      sendSuccess(res, await reports.retryAnalysis(getAuthUser(req).id, id(req.params)));
    },

    list: async (req, res) => {
      sendSuccess(res, await reports.list(parseInput(listAdminReportsQuerySchema, req.query)));
    },

    get: async (req, res) => {
      sendSuccess(res, { report: await reports.get(id(req.params)) });
    },

    review: async (req, res) => {
      const reportId = id(req.params);
      sendSuccess(res, await reports.review(getAuthUser(req).id, reportId));
    },

    decide: async (req, res) => {
      const reportId = id(req.params);
      const input = parseInput(decisionSchema, req.body);
      sendSuccess(res, await reports.decide(getAuthUser(req).id, reportId, input));
    },

    setSeverity: async (req, res) => {
      const reportId = id(req.params);
      const { severity } = parseInput(severitySchema, req.body);
      sendSuccess(res, await reports.setSeverity(getAuthUser(req).id, reportId, severity));
    },

    feedback: async (req, res) => {
      const reportId = id(req.params);
      const input = parseInput(feedbackSchema, req.body);
      sendSuccess(res, await reports.addFeedback(getAuthUser(req).id, reportId, input));
    },

    confirmCompletion: async (req, res) => {
      const reportId = id(req.params);
      const input = parseInput(confirmCompletionSchema, req.body);
      sendSuccess(res, await reports.confirmCompletion(getAuthUser(req).id, reportId, input));
    },

    suggestions: async (req, res) => {
      sendSuccess(res, { engineers: await assignments.suggestions(id(req.params)) });
    },

    assign: async (req, res) => {
      const reportId = id(req.params);
      const input = parseInput(assignEngineerSchema, req.body);
      sendSuccess(res, await assignments.assign(getAuthUser(req).id, reportId, input));
    },
  };
}

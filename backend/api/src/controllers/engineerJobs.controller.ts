import type { RequestHandler } from "express";
import { getAuthUser } from "../middleware/auth.js";
import type { EngineerJobService } from "../services/engineerJob.service.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { HttpError } from "../utils/httpError.js";
import { parseInput } from "../utils/validation.js";
import {
  engineerJobsQuerySchema,
  jobIdParamsSchema,
  repairNoteSchema,
  repairPhotoFieldsSchema,
  repairPhotoParamsSchema,
  repairStatusSchema,
} from "../validation/schemas.js";

export interface EngineerJobsController {
  summary: RequestHandler;
  list: RequestHandler;
  get: RequestHandler;
  setRepairStatus: RequestHandler;
  addNote: RequestHandler;
  addPhoto: RequestHandler;
  repairPhoto: RequestHandler;
}

/** ENGINEER only (enforced by the router); every query is limited to the engineer's own jobs. */
export function createEngineerJobsController(deps: { jobs: EngineerJobService }): EngineerJobsController {
  const { jobs } = deps;
  const jobId = (params: unknown): string => parseInput(jobIdParamsSchema, params).reportId;

  return {
    summary: async (req, res) => {
      sendSuccess(res, { summary: await jobs.summary(getAuthUser(req).id) });
    },

    list: async (req, res) => {
      sendSuccess(res, await jobs.list(getAuthUser(req).id, parseInput(engineerJobsQuerySchema, req.query)));
    },

    get: async (req, res) => {
      sendSuccess(res, { job: await jobs.get(getAuthUser(req).id, jobId(req.params)) });
    },

    setRepairStatus: async (req, res) => {
      const reportId = jobId(req.params);
      const input = parseInput(repairStatusSchema, req.body);
      sendSuccess(res, { job: await jobs.setRepairStatus(getAuthUser(req).id, reportId, input) });
    },

    addNote: async (req, res) => {
      const reportId = jobId(req.params);
      const input = parseInput(repairNoteSchema, req.body);
      sendSuccess(res, { job: await jobs.addNote(getAuthUser(req).id, reportId, input) });
    },

    addPhoto: async (req, res) => {
      const reportId = jobId(req.params);
      const { expectedAttempt } = parseInput(repairPhotoFieldsSchema, req.body);
      if (req.file === undefined) {
        throw new HttpError(400, "IMAGE_REQUIRED", "Add a photo of the repair.");
      }
      sendSuccess(res, await jobs.addPhoto(getAuthUser(req).id, reportId, expectedAttempt, req.file.buffer), 201);
    },

    repairPhoto: async (req, res) => {
      const { id, photoId } = parseInput(repairPhotoParamsSchema, req.params);
      const data = await jobs.getRepairPhoto(getAuthUser(req), id, photoId);
      res.set({ "Content-Type": "image/jpeg", "Cache-Control": "private, no-store", "Content-Disposition": "inline" });
      res.send(data);
    },
  };
}

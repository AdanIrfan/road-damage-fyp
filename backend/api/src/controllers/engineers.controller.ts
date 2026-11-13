import type { RequestHandler } from "express";
import { getAuthUser } from "../middleware/auth.js";
import type { AuthService } from "../services/auth.service.js";
import type { EngineerService } from "../services/engineer.service.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { parseInput } from "../utils/validation.js";
import {
  createEngineerSchema,
  engineerIdParamsSchema,
  engineerStatusSchema,
  listEngineersQuerySchema,
  updateEngineerSchema,
} from "../validation/schemas.js";

export interface EngineersController {
  list: RequestHandler;
  create: RequestHandler;
  get: RequestHandler;
  update: RequestHandler;
  setStatus: RequestHandler;
}

/** Admin-only (enforced by the router). Responses never contain passwords or hashes. */
export function createEngineersController(deps: { engineers: EngineerService; auth: AuthService }): EngineersController {
  const { engineers, auth } = deps;

  return {
    list: async (req, res) => {
      const query = parseInput(listEngineersQuerySchema, req.query);
      sendSuccess(res, await engineers.list(query));
    },

    create: async (req, res) => {
      const input = parseInput(createEngineerSchema, req.body);
      const engineer = await engineers.create(getAuthUser(req).id, {
        ...input,
        mobileNumber: auth.normalizeMobileOrThrow(input.mobileNumber),
      });
      sendSuccess(res, { engineer }, 201);
    },

    get: async (req, res) => {
      const { id } = parseInput(engineerIdParamsSchema, req.params);
      sendSuccess(res, { engineer: await engineers.get(id) });
    },

    update: async (req, res) => {
      const { id } = parseInput(engineerIdParamsSchema, req.params);
      const input = parseInput(updateEngineerSchema, req.body);
      const engineer = await engineers.update(id, {
        fullName: input.fullName,
        mobileNumber: input.mobileNumber === undefined ? undefined : auth.normalizeMobileOrThrow(input.mobileNumber),
      });
      sendSuccess(res, { engineer });
    },

    setStatus: async (req, res) => {
      const { id } = parseInput(engineerIdParamsSchema, req.params);
      const { status } = parseInput(engineerStatusSchema, req.body);
      sendSuccess(res, { engineer: await engineers.setStatus(id, status) });
    },
  };
}

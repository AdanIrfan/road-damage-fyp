import type { RequestHandler } from "express";
import type { DatabaseHealthCheck } from "../services/health.service.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { HttpError } from "../utils/httpError.js";

export interface ApiHealthData {
  status: "ok";
  timestamp: string;
}

export interface DatabaseHealthData {
  status: "ok";
  database: "up";
  timestamp: string;
}

export interface HealthController {
  getApiHealth: RequestHandler;
  getDatabaseHealth: RequestHandler;
}

export function createHealthController(checkDatabase: DatabaseHealthCheck): HealthController {
  return {
    getApiHealth: (_req, res) => {
      const data: ApiHealthData = { status: "ok", timestamp: new Date().toISOString() };
      sendSuccess(res, data);
    },

    getDatabaseHealth: async (_req, res) => {
      try {
        await checkDatabase();
      } catch (error) {
        // The real cause is logged by the error handler; clients only see a generic message.
        throw new HttpError(503, "DATABASE_UNAVAILABLE", "Database is unavailable.", { cause: error });
      }
      const data: DatabaseHealthData = { status: "ok", database: "up", timestamp: new Date().toISOString() };
      sendSuccess(res, data);
    },
  };
}

import { Router } from "express";
import { createHealthController } from "../controllers/health.controller.js";
import type { DatabaseHealthCheck } from "../services/health.service.js";
import { createHealthRouter } from "./health.routes.js";
import { createV1Router, type V1Dependencies } from "./v1/index.js";

export interface RouteDependencies {
  checkDatabase: DatabaseHealthCheck;
  /** Application routes. Optional so tests of unrelated parts need no services. */
  v1?: V1Dependencies;
}

/**
 * All routes under /api.
 * - /api/health, /api/health/db: unversioned operational endpoints.
 * - /api/v1/...: versioned application routes.
 */
export function createApiRouter(deps: RouteDependencies): Router {
  const router = Router();
  router.use("/health", createHealthRouter(createHealthController(deps.checkDatabase)));
  router.use("/v1", createV1Router(deps.v1));
  return router;
}

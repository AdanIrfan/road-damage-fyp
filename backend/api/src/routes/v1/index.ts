import { Router } from "express";

/**
 * Version 1 of the application API, mounted at /api/v1.
 * All application routes (auth, users, reports, assignments, ...) go here, e.g.
 *   router.use("/reports", createReportsRouter(...));
 * Intentionally empty until those features are approved and implemented.
 */
export function createV1Router(): Router {
  return Router();
}

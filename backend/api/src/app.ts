import express, { type Express } from "express";
import helmet from "helmet";
import { createCorsMiddleware } from "./middleware/cors.js";
import { createErrorHandler } from "./middleware/errorHandler.js";
import { notFoundHandler } from "./middleware/notFound.js";
import { requestContext, requestLogger } from "./middleware/requestLogger.js";
import { createApiRouter, type RouteDependencies } from "./routes/index.js";

export interface AppOptions {
  /** Include stack traces in error responses. Development only. */
  exposeErrorStack: boolean;
  /** Log each request to the console. */
  logRequests: boolean;
  /** Browser origins allowed by CORS. */
  corsOrigins: readonly string[];
}

/** Maximum JSON body size. File uploads will use multipart/form-data with their own limits. */
const JSON_BODY_LIMIT = "100kb";

/**
 * Builds the Express application without starting a server,
 * so tests can create it with fake dependencies.
 */
export function createApp(deps: RouteDependencies, options: AppOptions): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  // First, so every later middleware (and every log line) has the request id.
  app.use(requestContext);
  if (options.logRequests) {
    app.use(requestLogger);
  }
  // Before the body parser and routes, so preflights and rejected origins stop here.
  app.use(createCorsMiddleware(options.corsOrigins));
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  app.use("/api", createApiRouter(deps));

  app.use(notFoundHandler);
  app.use(createErrorHandler({ exposeStack: options.exposeErrorStack }));

  return app;
}

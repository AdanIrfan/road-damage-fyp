import { createServer, type Server } from "node:http";
import { createApp } from "./app.js";
import { EnvValidationError, loadEnvFile, parseEnv } from "./config/env.js";
import { createPrismaClient, type PrismaClient } from "./db/prisma.js";
import { attachChatGateway, type ChatGateway } from "./realtime/chatGateway.js";
import { createDatabaseHealthCheck } from "./services/health.service.js";
import { createHttpAiClient, unconfiguredAiClient } from "./services/ai/aiClient.js";
import { createServices } from "./services/index.js";
import { createSmsSender } from "./services/sms/index.js";
import { createLocalFileStorage } from "./services/storage/fileStorage.js";
import { logger } from "./utils/logger.js";

/** Force the process to exit if a graceful shutdown takes longer than this. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  loadEnvFile();
  const env = parseEnv(process.env);

  // Fails at startup (not on the first SMS) if the SMS configuration is not allowed.
  const sms = createSmsSender(env);
  const storage = await createLocalFileStorage(env.uploadDir);
  const ai =
    env.ai === undefined
      ? unconfiguredAiClient
      : createHttpAiClient({ baseUrl: env.ai.url, secret: env.ai.secret, timeoutMs: env.ai.timeoutMs });
  const prisma = createPrismaClient(env.databaseUrl);
  const services = createServices({
    prisma,
    authSecret: env.authSecret,
    sms,
    phoneDefaultCountry: env.phoneDefaultCountry,
    ai,
    storage,
    location: {
      exifLocationToleranceKm: env.exifLocationToleranceKm,
      gpsAccuracyThresholdMeters: env.gpsAccuracyThresholdMeters,
    },
  });
  const app = createApp(
    {
      checkDatabase: createDatabaseHealthCheck(prisma),
      v1: {
        services,
        cookies: { secure: env.nodeEnv === "production", sameSite: env.cookieSameSite },
        rateLimiting: env.nodeEnv !== "test",
      },
    },
    {
      exposeErrorStack: env.nodeEnv === "development",
      logRequests: env.nodeEnv !== "test",
      corsOrigins: env.corsOrigins,
    },
  );
  const server = createServer(app);
  // Admin–engineer chat WebSocket on the same server (same origin, same session cookie).
  const chatGateway = attachChatGateway(server, {
    tokens: services.tokens,
    users: services.users,
    chat: services.chat,
    allowedOrigins: env.corsOrigins,
  });

  try {
    await listen(server, env.port);
  } catch (error) {
    await prisma.$disconnect();
    throw error;
  }

  logger.info("server_started", {
    url: `http://localhost:${env.port}`,
    environment: env.nodeEnv,
    corsOrigins: env.corsOrigins,
    // Only the origin of the AI service is logged; the secret never is.
    aiService: env.ai === undefined ? "not configured (analyses will fail)" : new URL(env.ai.url).origin,
  });
  if (sms.providerName === "mock") {
    logger.warn("sms_mock_in_use", { note: "SMS messages are NOT delivered; codes are printed to this console." });
  }
  registerShutdownHandlers(server, prisma, chatGateway);
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function registerShutdownHandlers(server: Server, prisma: PrismaClient, chatGateway: ChatGateway): void {
  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info("shutdown_started", { signal });

    const forceExit = setTimeout(() => {
      logger.error("shutdown_timed_out");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    // Chat sockets are long-lived; close them so they do not hold the shutdown open.
    chatGateway.close();
    // Stop accepting connections, wait for in-flight requests, then close the database pool.
    server.close((closeError) => {
      prisma
        .$disconnect()
        .catch((disconnectError: unknown) => {
          logger.error("prisma_disconnect_failed", { error: disconnectError });
          process.exitCode = 1;
        })
        .finally(() => {
          if (closeError !== undefined) {
            logger.error("http_server_close_failed", { error: closeError });
            process.exitCode = 1;
          }
          logger.info("shutdown_complete");
          clearTimeout(forceExit);
        });
    });
    // Idle keep-alive connections would otherwise delay server.close().
    server.closeIdleConnections();
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
  if (error instanceof EnvValidationError) {
    console.error(error.message);
  } else {
    logger.error("server_start_failed", { error });
  }
  process.exitCode = 1;
});

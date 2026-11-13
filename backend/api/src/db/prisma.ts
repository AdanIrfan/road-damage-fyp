import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

/** Give up on a new database connection after this long, so health checks fail fast. */
const CONNECTION_TIMEOUT_MS = 5_000;

/**
 * Creates the Prisma client for the application.
 * Create it ONCE at startup (see src/index.ts) and pass it to the services that need it;
 * every PrismaClient owns its own connection pool.
 *
 * Prisma 7 connects through a driver adapter. The `pg` adapter does not read the
 * `?schema=` URL parameter, so it is read here and passed explicitly.
 */
export function createPrismaClient(databaseUrl: string): PrismaClient {
  const schema = new URL(databaseUrl).searchParams.get("schema") ?? undefined;
  const adapter = new PrismaPg(
    { connectionString: databaseUrl, connectionTimeoutMillis: CONNECTION_TIMEOUT_MS },
    schema === undefined ? undefined : { schema },
  );
  return new PrismaClient({ adapter });
}

export type { PrismaClient };

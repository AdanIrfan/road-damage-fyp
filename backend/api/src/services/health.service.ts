import type { PrismaClient } from "../db/prisma.js";

/** Resolves if the database answers a trivial query, rejects otherwise. */
export type DatabaseHealthCheck = () => Promise<void>;

export function createDatabaseHealthCheck(prisma: PrismaClient): DatabaseHealthCheck {
  return async () => {
    await prisma.$queryRaw`SELECT 1`;
  };
}

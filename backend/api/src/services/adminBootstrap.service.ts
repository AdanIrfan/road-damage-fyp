import type { PrismaClient } from "../db/prisma.js";
import { hashPassword } from "./password.service.js";
import { publicUserSelect, type PublicUser } from "./user.service.js";

/** Arbitrary constant identifying the "create admin" advisory lock. */
const ADMIN_BOOTSTRAP_LOCK_ID = 7_310_001;

export class AdminBootstrapError extends Error {}

/**
 * Creates an admin account. Used ONLY by the CLI script (there is no HTTP endpoint).
 * - If an admin already exists, `allowAdditional` must be true; this prevents running the
 *   "first admin" bootstrap twice by accident.
 * - A PostgreSQL advisory lock serialises concurrent runs, so two processes cannot both
 *   create a "first" admin.
 * `mobileNumber` must already be normalized (E.164).
 */
export async function createAdminAccount(
  prisma: PrismaClient,
  input: { fullName: string; mobileNumber: string; password: string },
  options: { allowAdditional: boolean },
): Promise<PublicUser> {
  const passwordHash = await hashPassword(input.password);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADMIN_BOOTSTRAP_LOCK_ID})`;

    const existingAdmins = await tx.user.count({ where: { role: "ADMIN" } });
    if (existingAdmins > 0 && !options.allowAdditional) {
      throw new AdminBootstrapError(
        `An admin account already exists (${existingAdmins}). Re-run with --additional to create another admin.`,
      );
    }

    const taken = await tx.user.findUnique({ where: { mobileNumber: input.mobileNumber }, select: { id: true } });
    if (taken !== null) {
      throw new AdminBootstrapError("An account with this mobile number already exists.");
    }

    return tx.user.create({
      data: {
        fullName: input.fullName,
        mobileNumber: input.mobileNumber,
        passwordHash,
        role: "ADMIN",
        status: "ACTIVE",
        mustChangePassword: false,
      },
      select: publicUserSelect,
    });
  });
}

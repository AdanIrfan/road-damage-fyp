import type { PrismaClient } from "../db/prisma.js";
import { Prisma, type AccountStatus, type UserRole } from "../generated/prisma/client.js";
import { newPasswordSchema } from "../validation/schemas.js";
import { systemClock, type Clock } from "./clock.js";
import { hashPassword } from "./password.service.js";

/** Expected problems with a safe, printable message (never contains a password or hash). */
export class PasswordResetError extends Error {}

/** What the reset tool shows for confirmation. Deliberately excludes the password hash. */
export interface ResettableAccount {
  id: string;
  fullName: string;
  mobileNumber: string;
  role: UserRole;
  status: AccountStatus;
  mobileVerifiedAt: Date | null;
}

/** `mobileNumber` must already be normalized (E.164). */
export function findAccountByMobile(prisma: PrismaClient, mobileNumber: string): Promise<ResettableAccount | null> {
  return prisma.user.findUnique({
    where: { mobileNumber },
    select: { id: true, fullName: true, mobileNumber: true, role: true, status: true, mobileVerifiedAt: true },
  });
}

/** Returns the first problem with a new password under the normal rules, or undefined if it is valid. */
export function passwordProblem(password: string): string | undefined {
  const result = newPasswordSchema.safeParse(password);
  return result.success ? undefined : result.error.issues[0]?.message;
}

/**
 * Sets a new password for one existing account (CLI reset tool).
 *
 * - Only `password_hash` of that user row changes; role, status, verification, profile,
 *   `must_change_password` and all reports stay as they are.
 * - Every refresh token of the account is revoked in the same transaction (the same rule as a
 *   normal password change), so all existing logins end at their next refresh. An access token
 *   issued before the reset stays valid until it expires (at most 15 minutes), as with logout.
 */
export async function resetAccountPassword(
  prisma: PrismaClient,
  accountId: string,
  newPassword: string,
  clock: Clock = systemClock,
): Promise<{ revokedSessions: number }> {
  const problem = passwordProblem(newPassword);
  if (problem !== undefined) {
    throw new PasswordResetError(problem);
  }
  const passwordHash = await hashPassword(newPassword);

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: accountId }, data: { passwordHash }, select: { id: true } });
      const revoked = await tx.refreshToken.updateMany({
        where: { userId: accountId, revokedAt: null },
        data: { revokedAt: clock() },
      });
      return { revokedSessions: revoked.count };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      throw new PasswordResetError("The account no longer exists. Nothing was changed.");
    }
    throw error;
  }
}

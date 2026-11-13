import type { PrismaClient } from "../db/prisma.js";
import type { Prisma } from "../generated/prisma/client.js";

/**
 * The ONLY user fields that may leave the server. Never add passwordHash here.
 * Every query that returns users to clients must use this select.
 */
export const publicUserSelect = {
  id: true,
  fullName: true,
  mobileNumber: true,
  role: true,
  status: true,
  mobileVerifiedAt: true,
  mustChangePassword: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export type PublicUser = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>;

export interface UserService {
  /** Returns the user only if the account exists and is ACTIVE. */
  findActiveById(id: string): Promise<PublicUser | null>;
  updateProfile(userId: string, input: { fullName: string }): Promise<PublicUser>;
}

export function createUserService(prisma: PrismaClient): UserService {
  return {
    findActiveById: (id) =>
      prisma.user.findFirst({ where: { id, status: "ACTIVE" }, select: publicUserSelect }),

    updateProfile: (userId, input) =>
      prisma.user.update({ where: { id: userId }, data: { fullName: input.fullName }, select: publicUserSelect }),
  };
}

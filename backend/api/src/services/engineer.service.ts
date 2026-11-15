import type { PrismaClient } from "../db/prisma.js";
import { Prisma, type AccountStatus } from "../generated/prisma/client.js";
import { HttpError } from "../utils/httpError.js";
import { hashPassword } from "./password.service.js";
import type { TokenService } from "./token.service.js";
import { publicUserSelect, type PublicUser } from "./user.service.js";

export interface EngineerListQuery {
  status?: AccountStatus | undefined;
  search?: string | undefined;
  page: number;
  pageSize: number;
}

/** Stage 4 workload figures shown to admins. */
export interface EngineerWorkload {
  /** Report ACCEPTED, repair PENDING or WORKING. */
  openJobs: number;
  /** Repair COMPLETED, waiting for an admin to confirm. */
  awaitingConfirmation: number;
  /** Reports COMPLETED while assigned to this engineer. */
  completedJobs: number;
}

export type EngineerWithWorkload = PublicUser & { workload: EngineerWorkload };

export interface EngineerList {
  items: EngineerWithWorkload[];
  page: number;
  pageSize: number;
  total: number;
}

export interface EngineerService {
  list(query: EngineerListQuery): Promise<EngineerList>;
  get(id: string): Promise<EngineerWithWorkload>;
  /** `mobileNumber` must already be normalized (E.164). */
  create(adminId: string, input: { fullName: string; mobileNumber: string; temporaryPassword: string }): Promise<PublicUser>;
  update(id: string, input: { fullName?: string | undefined; mobileNumber?: string | undefined }): Promise<PublicUser>;
  setStatus(id: string, status: "ACTIVE" | "DEACTIVATED"): Promise<PublicUser>;
}

const notFound = (): HttpError => new HttpError(404, "ENGINEER_NOT_FOUND", "Engineer not found.");
const mobileTaken = (): HttpError =>
  new HttpError(409, "MOBILE_ALREADY_REGISTERED", "An account with this mobile number already exists.");

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export function createEngineerService(deps: { prisma: PrismaClient; tokens: TokenService }): EngineerService {
  const { prisma, tokens } = deps;

  const workloads = async (ids: readonly string[]): Promise<Map<string, EngineerWorkload>> => {
    const groups = await prisma.report.groupBy({
      by: ["assignedEngineerId", "status", "repairStatus"],
      where: { assignedEngineerId: { in: [...ids] }, status: { in: ["ACCEPTED", "COMPLETED"] } },
      _count: { _all: true },
    });
    const result = new Map(ids.map((id) => [id, { openJobs: 0, awaitingConfirmation: 0, completedJobs: 0 }]));
    for (const g of groups) {
      const w = g.assignedEngineerId === null ? undefined : result.get(g.assignedEngineerId);
      if (w === undefined) continue;
      if (g.status === "COMPLETED") w.completedJobs += g._count._all;
      else if (g.repairStatus === "COMPLETED") w.awaitingConfirmation += g._count._all;
      else w.openJobs += g._count._all;
    }
    return result;
  };

  const withWorkload = async (users: PublicUser[]): Promise<EngineerWithWorkload[]> => {
    const map = await workloads(users.map((u) => u.id));
    return users.map((u) => ({ ...u, workload: map.get(u.id) ?? { openJobs: 0, awaitingConfirmation: 0, completedJobs: 0 } }));
  };

  const requireEngineer = async (id: string): Promise<void> => {
    const found = await prisma.user.findFirst({ where: { id, role: "ENGINEER" }, select: { id: true } });
    if (found === null) {
      throw notFound();
    }
  };

  return {
    list: async ({ status, search, page, pageSize }) => {
      const where: Prisma.UserWhereInput = {
        role: "ENGINEER",
        ...(status === undefined ? {} : { status }),
        ...(search === undefined || search === ""
          ? {}
          : {
              OR: [
                { fullName: { contains: search, mode: "insensitive" } },
                { mobileNumber: { contains: search.replace(/[\s()-]/g, "") } },
              ],
            }),
      };
      const [items, total] = await prisma.$transaction([
        prisma.user.findMany({
          where,
          select: publicUserSelect,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.user.count({ where }),
      ]);
      return { items: await withWorkload(items), page, pageSize, total };
    },

    get: async (id) => {
      const engineer = await prisma.user.findFirst({ where: { id, role: "ENGINEER" }, select: publicUserSelect });
      if (engineer === null) {
        throw notFound();
      }
      const [withCounts] = await withWorkload([engineer]);
      return withCounts ?? { ...engineer, workload: { openJobs: 0, awaitingConfirmation: 0, completedJobs: 0 } };
    },

    create: async (adminId, input) => {
      const passwordHash = await hashPassword(input.temporaryPassword);
      try {
        return await prisma.user.create({
          data: {
            fullName: input.fullName,
            mobileNumber: input.mobileNumber,
            passwordHash,
            role: "ENGINEER",
            status: "ACTIVE",
            // The admin chose this password, so the engineer must replace it on first login.
            mustChangePassword: true,
            createdById: adminId,
          },
          select: publicUserSelect,
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw mobileTaken();
        }
        throw error;
      }
    },

    update: async (id, input) => {
      await requireEngineer(id);
      try {
        return await prisma.user.update({
          where: { id },
          data: {
            ...(input.fullName === undefined ? {} : { fullName: input.fullName }),
            ...(input.mobileNumber === undefined ? {} : { mobileNumber: input.mobileNumber }),
          },
          select: publicUserSelect,
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw mobileTaken();
        }
        throw error;
      }
    },

    setStatus: async (id, status) => {
      await requireEngineer(id);
      const engineer = await prisma.user.update({ where: { id }, data: { status }, select: publicUserSelect });
      if (status === "DEACTIVATED") {
        // Deactivation takes effect immediately: refresh fails and access tokens are rejected
        // because every request re-checks the account status.
        await tokens.revokeAllSessions(id);
      }
      return engineer;
    },
  };
}

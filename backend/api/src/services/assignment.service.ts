import type { PrismaClient } from "../db/prisma.js";
import { HttpError } from "../utils/httpError.js";
import { reportNotFound, stateConflict, type AdminActionResult, type AdminReportService } from "./adminReport.service.js";
import type { Clock } from "./clock.js";
import { canAssign, nextAttempt } from "./reportWorkflow.js";

export interface EngineerSuggestion {
  id: string;
  fullName: string;
  mobileNumber: string;
  /** Jobs in progress: assigned, report ACCEPTED, repair PENDING or WORKING. */
  openJobs: number;
  /** The engineer still has an admin-set temporary password (cannot open jobs until changed). */
  mustChangePassword: boolean;
  /** Already assigned to this report. */
  isCurrent: boolean;
}

export interface AssignmentService {
  /**
   * Agreed formula (2026-11-14): only ACTIVE engineers, fewest open jobs first, ties by name.
   * The admin makes the final choice.
   */
  suggestions(reportId: string): Promise<EngineerSuggestion[]>;
  /** Assigns or reassigns an ACCEPTED report. Every (re)assignment starts a new repair attempt at PENDING. */
  assign(adminId: string, reportId: string, input: { engineerId: string; reason?: string | undefined }): Promise<AdminActionResult>;
}

export function createAssignmentService(deps: { prisma: PrismaClient; adminReports: AdminReportService; clock: Clock }): AssignmentService {
  const { prisma, adminReports, clock } = deps;

  return {
    suggestions: async (reportId) => {
      const report = await prisma.report.findUnique({ where: { id: reportId }, select: { status: true, assignedEngineerId: true } });
      if (report === null) {
        throw reportNotFound();
      }
      if (!canAssign(report.status)) {
        throw new HttpError(409, "INVALID_TRANSITION", "Only accepted reports can be assigned.");
      }
      const [engineers, load] = await Promise.all([
        prisma.user.findMany({
          where: { role: "ENGINEER", status: "ACTIVE" },
          select: { id: true, fullName: true, mobileNumber: true, mustChangePassword: true },
        }),
        openJobCounts(prisma),
      ]);
      return engineers
        .map((e) => ({ ...e, openJobs: load.get(e.id) ?? 0, isCurrent: e.id === report.assignedEngineerId }))
        .sort((a, b) => a.openJobs - b.openJobs || a.fullName.localeCompare(b.fullName));
    },

    assign: async (adminId, reportId, { engineerId, reason }) => {
      const report = await prisma.report.findUnique({
        where: { id: reportId },
        select: { status: true, assignedEngineerId: true, repairAttempt: true },
      });
      if (report === null) {
        throw reportNotFound();
      }
      if (!canAssign(report.status)) {
        throw new HttpError(409, "INVALID_TRANSITION", "Only accepted reports can be assigned.");
      }
      if (report.assignedEngineerId === engineerId) {
        throw new HttpError(409, "INVALID_TRANSITION", "The report is already assigned to this engineer.");
      }
      const engineer = await prisma.user.findUnique({ where: { id: engineerId }, select: { role: true, status: true } });
      if (engineer === null || engineer.role !== "ENGINEER" || engineer.status !== "ACTIVE") {
        throw new HttpError(400, "ENGINEER_NOT_ASSIGNABLE", "Choose an active engineer account.");
      }

      const attempt = nextAttempt(report.repairAttempt);
      const now = clock();
      await prisma.$transaction(async (tx) => {
        // Conditional on what was read: a concurrent (re)assignment or status change matches 0 rows.
        const updated = await tx.report.updateMany({
          where: { id: reportId, status: "ACCEPTED", assignedEngineerId: report.assignedEngineerId, repairAttempt: report.repairAttempt },
          data: {
            assignedEngineerId: engineerId,
            assignedAt: now,
            // A new attempt starts in its initial state; earlier attempts' photos and updates stay as evidence.
            repairStatus: "PENDING",
            repairStatusUpdatedAt: now,
            repairAttempt: attempt,
          },
        });
        if (updated.count !== 1) {
          throw stateConflict();
        }
        await tx.reportAssignment.create({
          data: {
            reportId,
            engineerId,
            previousEngineerId: report.assignedEngineerId,
            assignedById: adminId,
            reason: reason?.trim() || null,
            attempt,
          },
        });
      });
      return { report: await adminReports.get(reportId) };
    },
  };
}

/** Open jobs per engineer: report ACCEPTED, repair PENDING or WORKING. */
export async function openJobCounts(prisma: PrismaClient): Promise<Map<string, number>> {
  const groups = await prisma.report.groupBy({
    by: ["assignedEngineerId"],
    where: { status: "ACCEPTED", assignedEngineerId: { not: null }, repairStatus: { in: ["PENDING", "WORKING"] } },
    _count: { _all: true },
  });
  return new Map(groups.flatMap((g) => (g.assignedEngineerId === null ? [] : [[g.assignedEngineerId, g._count._all] as const])));
}

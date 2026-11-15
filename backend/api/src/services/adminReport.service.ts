import { ADMIN_DASHBOARD_RECENT_COUNT } from "../config/workflow.js";
import type { PrismaClient } from "../db/prisma.js";
import type {
  AccountStatus,
  AiAnalysisStatus,
  CaptureMethod,
  LocationVerificationStatus,
  Prisma,
  RepairStatus,
  ReportStatus,
  SeverityLevel,
  UserRole,
} from "../generated/prisma/client.js";
import { HttpError } from "../utils/httpError.js";
import type { Clock } from "./clock.js";
import type { CitizenNotifiedStatus, NotificationOutcome, NotificationService } from "./notification.service.js";
import {
  assignmentHistorySelect,
  buildRepairAttempts,
  repairPhotosSelect,
  repairUpdatesSelect,
  type PersonRef,
  type RepairAttemptView,
} from "./repairViews.js";
import {
  canAssign,
  canDecide,
  canReview,
  DECISION_TARGET,
  decisionRequiresReason,
  effectiveSeverity,
  isAwaitingConfirmation,
  shouldNotifyCitizen,
  type Decision,
} from "./reportWorkflow.js";
import { detectionsSelect, detectionViews, imageSelect, imageView, type DetectionView, type ReportImageView } from "./reportViews.js";

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface AdminAllowedActions {
  review: boolean;
  /** Accept / Reject / Delay (from UNDER_REVIEW, or "keep delayed" from DELAYED). */
  decide: boolean;
  assign: boolean;
  /** "Needs more work" — only while the current attempt is Completed and awaiting confirmation. */
  feedback: boolean;
  confirmCompletion: boolean;
}

export interface AdminReportView {
  id: string;
  status: ReportStatus;
  captureMethod: CaptureMethod;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  citizen: { id: string; fullName: string; mobileNumber: string; status: AccountStatus };
  location: {
    latitude: number;
    longitude: number;
    gpsAccuracyMeters: number | null;
    verificationStatus: LocationVerificationStatus;
    needsReview: boolean;
    /** EXIF position of the original photo (admins only). */
    exif: { latitude: number; longitude: number; distanceMeters: number | null } | null;
  };
  analysis: {
    status: AiAnalysisStatus;
    errorCode: string | null;
    analyzedAt: Date | null;
    model: string | null;
    detections: DetectionView[];
    severityScore: number | null;
  };
  severity: {
    /** Heuristic AI estimate (never overwritten). */
    ai: SeverityLevel | null;
    admin: SeverityLevel | null;
    effective: SeverityLevel | null;
    adminSetBy: PersonRef | null;
    adminSetAt: Date | null;
  };
  image: ReportImageView | null;
  assignment: {
    status: "ASSIGNED" | "UNASSIGNED";
    engineer: (PersonRef & { mobileNumber: string; status: AccountStatus; mustChangePassword: boolean }) | null;
    assignedAt: Date | null;
    repairStatus: RepairStatus | null;
    repairStatusUpdatedAt: Date | null;
    currentAttempt: number | null;
  };
  statusHistory: {
    id: string;
    fromStatus: ReportStatus | null;
    toStatus: ReportStatus;
    note: string | null;
    changedBy: (PersonRef & { role: UserRole }) | null;
    createdAt: Date;
  }[];
  assignmentHistory: {
    id: string;
    attempt: number;
    reason: string | null;
    engineer: PersonRef;
    previousEngineer: PersonRef | null;
    assignedBy: PersonRef;
    createdAt: Date;
  }[];
  repairAttempts: RepairAttemptView[];
  allowedActions: AdminAllowedActions;
}

export interface AdminReportListItem {
  id: string;
  status: ReportStatus;
  captureMethod: CaptureMethod;
  createdAt: Date;
  description: string | null;
  citizen: PersonRef;
  severity: { ai: SeverityLevel | null; admin: SeverityLevel | null; effective: SeverityLevel | null };
  analysis: { status: AiAnalysisStatus; detectionCount: number; damageClasses: string[] };
  location: { verificationStatus: LocationVerificationStatus; needsReview: boolean };
  assignment: { engineer: PersonRef | null; repairStatus: RepairStatus | null; currentAttempt: number | null };
  image: ReportImageView | null;
}

export interface AdminReportListQuery {
  page: number;
  pageSize: number;
  sort: "newest" | "oldest";
  search?: string | undefined;
  status?: ReportStatus | undefined;
  severity?: SeverityLevel | undefined;
  from?: string | undefined;
  to?: string | undefined;
  captureMethod?: CaptureMethod | undefined;
  locationStatus?: LocationVerificationStatus | undefined;
  needsLocationReview?: boolean | undefined;
  aiStatus?: AiAnalysisStatus | undefined;
  damageClass?: string | undefined;
  assignment?: "assigned" | "unassigned" | undefined;
  engineerId?: string | undefined;
  repairStatus?: RepairStatus | undefined;
}

export interface AdminDashboard {
  total: number;
  byStatus: Record<ReportStatus, number>;
  bySeverity: Record<SeverityLevel | "NONE", number>;
  queues: {
    awaitingReview: number;
    underReview: number;
    delayed: number;
    awaitingAssignment: number;
    inProgress: number;
    awaitingConfirmation: number;
    /** Open (not rejected/completed) reports whose location needs checking. */
    locationFlagged: number;
    /** Open reports whose AI analysis failed. */
    aiFailed: number;
    jobsOnDeactivatedEngineers: number;
  };
  activeEngineers: number;
  recent: AdminReportListItem[];
}

/** Result of an admin action. `notification` is set when a citizen SMS was due. */
export interface AdminActionResult {
  report: AdminReportView;
  notification?: NotificationOutcome;
}

export interface AdminReportService {
  list(query: AdminReportListQuery): Promise<{ items: AdminReportListItem[]; page: number; pageSize: number; total: number }>;
  /** Read-only: opening a report never changes its status. */
  get(reportId: string): Promise<AdminReportView>;
  dashboard(): Promise<AdminDashboard>;
  review(adminId: string, reportId: string): Promise<AdminActionResult>;
  decide(adminId: string, reportId: string, input: { decision: Decision; reason?: string | undefined }): Promise<AdminActionResult>;
  setSeverity(adminId: string, reportId: string, severity: SeverityLevel): Promise<AdminActionResult>;
  addFeedback(adminId: string, reportId: string, input: { note: string; expectedAttempt: number }): Promise<AdminActionResult>;
  confirmCompletion(
    adminId: string,
    reportId: string,
    input: { expectedAttempt: number; note?: string | undefined },
  ): Promise<AdminActionResult>;
}

// ---------------------------------------------------------------------------
// Selects
// ---------------------------------------------------------------------------

const person = { select: { id: true, fullName: true } } as const;
const REPORT_STATUSES: readonly ReportStatus[] = ["SUBMITTED", "UNDER_REVIEW", "ACCEPTED", "REJECTED", "DELAYED", "COMPLETED"];
const OPEN_STATUSES: ReportStatus[] = ["SUBMITTED", "UNDER_REVIEW", "ACCEPTED", "DELAYED"];

const adminDetailSelect = {
  id: true,
  status: true,
  captureMethod: true,
  description: true,
  createdAt: true,
  updatedAt: true,
  latitude: true,
  longitude: true,
  gpsAccuracyM: true,
  locationStatus: true,
  locationNeedsReview: true,
  exifLatitude: true,
  exifLongitude: true,
  exifDistanceM: true,
  aiStatus: true,
  aiErrorCode: true,
  aiAnalyzedAt: true,
  aiModel: true,
  aiSeverity: true,
  aiSeverityScore: true,
  adminSeverity: true,
  adminSeverityAt: true,
  adminSeverityBy: person,
  assignedAt: true,
  repairStatus: true,
  repairStatusUpdatedAt: true,
  repairAttempt: true,
  citizen: { select: { id: true, fullName: true, mobileNumber: true, status: true } },
  assignedEngineer: { select: { id: true, fullName: true, mobileNumber: true, status: true, mustChangePassword: true } },
  images: imageSelect,
  detections: detectionsSelect,
  statusHistory: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      note: true,
      createdAt: true,
      changedBy: { select: { id: true, fullName: true, role: true } },
    },
  },
  assignments: assignmentHistorySelect,
  repairUpdates: repairUpdatesSelect,
  repairPhotos: repairPhotosSelect,
} satisfies Prisma.ReportSelect;

const adminListSelect = {
  id: true,
  status: true,
  captureMethod: true,
  createdAt: true,
  description: true,
  aiSeverity: true,
  adminSeverity: true,
  aiStatus: true,
  locationStatus: true,
  locationNeedsReview: true,
  repairStatus: true,
  repairAttempt: true,
  citizen: person,
  assignedEngineer: person,
  images: imageSelect,
  detections: { select: { className: true } },
} satisfies Prisma.ReportSelect;

type AdminDetailRow = Prisma.ReportGetPayload<{ select: typeof adminDetailSelect }>;
type AdminListRow = Prisma.ReportGetPayload<{ select: typeof adminListSelect }>;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const reportNotFound = (): HttpError => new HttpError(404, "REPORT_NOT_FOUND", "Report not found.");
export const stateConflict = (): HttpError =>
  new HttpError(409, "REPORT_STATE_CONFLICT", "This report was changed in the meantime. Reload it and try again.");
const invalidTransition = (message: string): HttpError => new HttpError(409, "INVALID_TRANSITION", message);

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function createAdminReportService(deps: {
  prisma: PrismaClient;
  notifications: NotificationService;
  clock: Clock;
}): AdminReportService {
  const { prisma, notifications, clock } = deps;

  const load = async (reportId: string): Promise<AdminReportView> => {
    const row = await prisma.report.findUnique({ where: { id: reportId }, select: adminDetailSelect });
    if (row === null) {
      throw reportNotFound();
    }
    return toAdminView(row);
  };

  /** Minimal state needed to validate an action before the conditional update. */
  const current = async (reportId: string) => {
    const row = await prisma.report.findUnique({
      where: { id: reportId },
      select: { status: true, repairStatus: true, repairAttempt: true, citizen: { select: { mobileNumber: true } } },
    });
    if (row === null) {
      throw reportNotFound();
    }
    return row;
  };

  const notify = async (
    reportId: string,
    citizenMobile: string,
    from: ReportStatus,
    to: ReportStatus,
    reason: string | null | undefined,
  ): Promise<NotificationOutcome | undefined> => {
    if (!shouldNotifyCitizen(from, to)) {
      return undefined;
    }
    return notifications.notifyCitizenStatus({ reportId, citizenMobile, status: to as CitizenNotifiedStatus, reason });
  };

  return {
    list: async (query) => {
      const where = buildListWhere(query);
      // Not an array $transaction: inside one, Prisma 7 loads relations in parallel on a single pg
      // connection (pg 8.23 deprecation, an error in pg 9). READ COMMITTED gives no snapshot anyway.
      const [rows, total] = await Promise.all([
        prisma.report.findMany({
          where,
          select: adminListSelect,
          orderBy: [{ createdAt: query.sort === "newest" ? "desc" : "asc" }, { id: "asc" }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        prisma.report.count({ where }),
      ]);
      return { items: rows.map(toAdminListItem), page: query.page, pageSize: query.pageSize, total };
    },

    get: load,

    dashboard: async () => {
      const [statusGroups, severityGroups, queueCounts, activeEngineers, recentRows] = await Promise.all([
        prisma.report.groupBy({ by: ["status"], _count: { _all: true } }),
        prisma.report.groupBy({ by: ["adminSeverity", "aiSeverity"], _count: { _all: true } }),
        prisma.$transaction([
          prisma.report.count({ where: { status: "SUBMITTED" } }),
          prisma.report.count({ where: { status: "UNDER_REVIEW" } }),
          prisma.report.count({ where: { status: "DELAYED" } }),
          prisma.report.count({ where: { status: "ACCEPTED", assignedEngineerId: null } }),
          prisma.report.count({ where: { status: "ACCEPTED", assignedEngineerId: { not: null }, repairStatus: { in: ["PENDING", "WORKING"] } } }),
          prisma.report.count({ where: { status: "ACCEPTED", repairStatus: "COMPLETED" } }),
          prisma.report.count({ where: { status: { in: OPEN_STATUSES }, locationNeedsReview: true } }),
          prisma.report.count({ where: { status: { in: OPEN_STATUSES }, aiStatus: "FAILED" } }),
          prisma.report.count({ where: { status: "ACCEPTED", assignedEngineer: { status: "DEACTIVATED" } } }),
        ]),
        prisma.user.count({ where: { role: "ENGINEER", status: "ACTIVE" } }),
        prisma.report.findMany({
          select: adminListSelect,
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          take: ADMIN_DASHBOARD_RECENT_COUNT,
        }),
      ]);

      const byStatus = Object.fromEntries(REPORT_STATUSES.map((s) => [s, 0])) as Record<ReportStatus, number>;
      let total = 0;
      for (const group of statusGroups) {
        byStatus[group.status] = group._count._all;
        total += group._count._all;
      }
      const bySeverity: Record<SeverityLevel | "NONE", number> = { LOW: 0, MEDIUM: 0, HIGH: 0, NONE: 0 };
      for (const group of severityGroups) {
        bySeverity[effectiveSeverity(group.adminSeverity, group.aiSeverity) ?? "NONE"] += group._count._all;
      }
      const [awaitingReview, underReview, delayed, awaitingAssignment, inProgress, awaitingConfirmation, locationFlagged, aiFailed, deactivated] =
        queueCounts;
      return {
        total,
        byStatus,
        bySeverity,
        queues: {
          awaitingReview,
          underReview,
          delayed,
          awaitingAssignment,
          inProgress,
          awaitingConfirmation,
          locationFlagged,
          aiFailed,
          jobsOnDeactivatedEngineers: deactivated,
        },
        activeEngineers,
        recent: recentRows.map(toAdminListItem),
      };
    },

    review: async (adminId, reportId) => {
      const state = await current(reportId);
      if (!canReview(state.status)) {
        throw invalidTransition("Only submitted reports can be moved to Under review.");
      }
      await prisma.$transaction(async (tx) => {
        const updated = await tx.report.updateMany({ where: { id: reportId, status: "SUBMITTED" }, data: { status: "UNDER_REVIEW" } });
        if (updated.count !== 1) {
          throw stateConflict();
        }
        await tx.reportStatusHistory.create({
          data: { reportId, fromStatus: "SUBMITTED", toStatus: "UNDER_REVIEW", changedById: adminId },
        });
      });
      return { report: await load(reportId) };
    },

    decide: async (adminId, reportId, { decision, reason }) => {
      const state = await current(reportId);
      if (!canDecide(state.status)) {
        throw invalidTransition("Only reports under review or delayed can be accepted, rejected or delayed.");
      }
      const note = reason?.trim() || undefined;
      if (decisionRequiresReason(decision) && note === undefined) {
        throw new HttpError(400, "VALIDATION_ERROR", "Some fields are invalid.", {
          details: { fields: { reason: ["A reason is required to reject or delay a report."] }, formErrors: [] },
        });
      }
      const from = state.status;
      const to = DECISION_TARGET[decision];
      await prisma.$transaction(async (tx) => {
        // Conditional on the status read above: a concurrent or repeated decision matches 0 rows.
        // For "keep delayed" (DELAYED → DELAYED) this still locks the row and bumps updated_at.
        const updated = await tx.report.updateMany({ where: { id: reportId, status: from }, data: { status: to } });
        if (updated.count !== 1) {
          throw stateConflict();
        }
        await tx.reportStatusHistory.create({
          data: { reportId, fromStatus: from, toStatus: to, changedById: adminId, note: note ?? null },
        });
      });
      // Only after the commit, and only by the request whose update matched (no duplicates).
      const notification = await notify(reportId, state.citizen.mobileNumber, from, to, note);
      const report = await load(reportId);
      return notification === undefined ? { report } : { report, notification };
    },

    setSeverity: async (adminId, reportId, severity) => {
      await current(reportId);
      // The AI estimate (ai_severity) is never overwritten; both values are kept.
      await prisma.report.update({
        where: { id: reportId },
        data: { adminSeverity: severity, adminSeverityById: adminId, adminSeverityAt: clock() },
      });
      return { report: await load(reportId) };
    },

    addFeedback: async (adminId, reportId, { note, expectedAttempt }) => {
      const state = await current(reportId);
      if (!isAwaitingConfirmation(state.status, state.repairStatus)) {
        throw invalidTransition("Feedback can only be given on a repair that is completed and awaiting confirmation.");
      }
      if (state.repairAttempt !== expectedAttempt) {
        throw stateConflict();
      }
      await prisma.$transaction(async (tx) => {
        const locked = await tx.report.updateMany({
          where: { id: reportId, status: "ACCEPTED", repairStatus: "COMPLETED", repairAttempt: expectedAttempt },
          data: { updatedAt: clock() },
        });
        if (locked.count !== 1) {
          throw stateConflict();
        }
        await tx.repairUpdate.create({
          data: { reportId, authorId: adminId, kind: "ADMIN_FEEDBACK", attempt: expectedAttempt, note: note.trim() },
        });
      });
      return { report: await load(reportId) };
    },

    confirmCompletion: async (adminId, reportId, { expectedAttempt, note }) => {
      const state = await current(reportId);
      if (!isAwaitingConfirmation(state.status, state.repairStatus)) {
        throw invalidTransition("Only a repair that is completed and awaiting confirmation can be confirmed.");
      }
      if (state.repairAttempt !== expectedAttempt) {
        throw stateConflict();
      }
      await prisma.$transaction(async (tx) => {
        const updated = await tx.report.updateMany({
          where: { id: reportId, status: "ACCEPTED", repairStatus: "COMPLETED", repairAttempt: expectedAttempt },
          data: { status: "COMPLETED" },
        });
        if (updated.count !== 1) {
          throw stateConflict();
        }
        const extra = note?.trim();
        await tx.reportStatusHistory.create({
          data: {
            reportId,
            fromStatus: "ACCEPTED",
            toStatus: "COMPLETED",
            changedById: adminId,
            note: `Repair attempt ${expectedAttempt} confirmed.${extra ? ` ${extra}` : ""}`,
          },
        });
      });
      const notification = await notify(reportId, state.citizen.mobileNumber, "ACCEPTED", "COMPLETED", null);
      const report = await load(reportId);
      return notification === undefined ? { report } : { report, notification };
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function severityWhere(severity: SeverityLevel): Prisma.ReportWhereInput {
  return { OR: [{ adminSeverity: severity }, { adminSeverity: null, aiSeverity: severity }] };
}

function startOfDayUtc(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function buildListWhere(q: AdminReportListQuery): Prisma.ReportWhereInput {
  const and: Prisma.ReportWhereInput[] = [];
  if (q.status !== undefined) and.push({ status: q.status });
  if (q.severity !== undefined) and.push(severityWhere(q.severity));
  if (q.from !== undefined) and.push({ createdAt: { gte: startOfDayUtc(q.from) } });
  if (q.to !== undefined) {
    // Inclusive end date: everything before the start of the following day.
    const next = startOfDayUtc(q.to);
    next.setUTCDate(next.getUTCDate() + 1);
    and.push({ createdAt: { lt: next } });
  }
  if (q.captureMethod !== undefined) and.push({ captureMethod: q.captureMethod });
  if (q.locationStatus !== undefined) and.push({ locationStatus: q.locationStatus });
  if (q.needsLocationReview !== undefined) and.push({ locationNeedsReview: q.needsLocationReview });
  if (q.aiStatus !== undefined) and.push({ aiStatus: q.aiStatus });
  if (q.damageClass !== undefined) and.push({ detections: { some: { className: q.damageClass } } });
  if (q.assignment === "assigned") and.push({ assignedEngineerId: { not: null } });
  if (q.assignment === "unassigned") and.push({ assignedEngineerId: null });
  if (q.engineerId !== undefined) and.push({ assignedEngineerId: q.engineerId });
  if (q.repairStatus !== undefined) and.push({ repairStatus: q.repairStatus });
  const search = q.search?.trim();
  if (search) {
    const digits = search.replace(/[\s()-]/g, "");
    const or: Prisma.ReportWhereInput[] = [
      { citizen: { fullName: { contains: search, mode: "insensitive" } } },
      { description: { contains: search, mode: "insensitive" } },
    ];
    if (/^\+?\d{3,}$/.test(digits)) or.push({ citizen: { mobileNumber: { contains: digits } } });
    // A complete report id finds that report (UUID columns cannot be prefix-searched).
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(search)) or.push({ id: search.toLowerCase() });
    and.push({ OR: or });
  }
  return and.length === 0 ? {} : { AND: and };
}

function toAdminListItem(row: AdminListRow): AdminReportListItem {
  return {
    id: row.id,
    status: row.status,
    captureMethod: row.captureMethod,
    createdAt: row.createdAt,
    description: row.description,
    citizen: row.citizen,
    severity: { ai: row.aiSeverity, admin: row.adminSeverity, effective: effectiveSeverity(row.adminSeverity, row.aiSeverity) },
    analysis: {
      status: row.aiStatus,
      detectionCount: row.detections.length,
      damageClasses: [...new Set(row.detections.map((d) => d.className))].sort(),
    },
    location: { verificationStatus: row.locationStatus, needsReview: row.locationNeedsReview },
    assignment: { engineer: row.assignedEngineer, repairStatus: row.repairStatus, currentAttempt: row.repairAttempt },
    image: imageView(row.id, row.images[0]),
  };
}

function toAdminView(row: AdminDetailRow): AdminReportView {
  const awaiting = isAwaitingConfirmation(row.status, row.repairStatus);
  return {
    id: row.id,
    status: row.status,
    captureMethod: row.captureMethod,
    description: row.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    citizen: row.citizen,
    location: {
      latitude: row.latitude,
      longitude: row.longitude,
      gpsAccuracyMeters: row.gpsAccuracyM,
      verificationStatus: row.locationStatus,
      needsReview: row.locationNeedsReview,
      exif:
        row.exifLatitude !== null && row.exifLongitude !== null
          ? { latitude: row.exifLatitude, longitude: row.exifLongitude, distanceMeters: row.exifDistanceM }
          : null,
    },
    analysis: {
      status: row.aiStatus,
      errorCode: row.aiErrorCode,
      analyzedAt: row.aiAnalyzedAt,
      model: row.aiModel,
      detections: detectionViews(row.detections),
      severityScore: row.aiSeverityScore,
    },
    severity: {
      ai: row.aiSeverity,
      admin: row.adminSeverity,
      effective: effectiveSeverity(row.adminSeverity, row.aiSeverity),
      adminSetBy: row.adminSeverityBy,
      adminSetAt: row.adminSeverityAt,
    },
    image: imageView(row.id, row.images[0]),
    assignment: {
      status: row.assignedEngineer === null ? "UNASSIGNED" : "ASSIGNED",
      engineer: row.assignedEngineer,
      assignedAt: row.assignedAt,
      repairStatus: row.repairStatus,
      repairStatusUpdatedAt: row.repairStatusUpdatedAt,
      currentAttempt: row.repairAttempt,
    },
    statusHistory: row.statusHistory,
    assignmentHistory: row.assignments,
    repairAttempts: buildRepairAttempts(row.id, row.repairAttempt, row.assignments, row.repairUpdates, row.repairPhotos),
    allowedActions: {
      review: canReview(row.status),
      decide: canDecide(row.status),
      assign: canAssign(row.status),
      feedback: awaiting,
      confirmCompletion: awaiting,
    },
  };
}

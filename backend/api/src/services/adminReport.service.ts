import {
  ADMIN_DASHBOARD_RECENT_COUNT,
  ADMIN_MAP_MAX_POINTS,
  DUPLICATE_HINT_MAX_RESULTS,
  DUPLICATE_HINT_RADIUS_METERS,
  DUPLICATE_HINT_WINDOW_DAYS,
} from "../config/workflow.js";
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
import { logger } from "../utils/logger.js";
import { AiServiceError, type AiClient, type AiErrorKind } from "./ai/aiClient.js";
import { toDetectionRows } from "./analysisRows.js";
import { haversineMeters } from "./location/haversine.js";
import { estimateSeverity } from "./severity.js";
import type { FileStorage } from "./storage/fileStorage.js";
import type { Clock } from "./clock.js";
import type { CitizenNotifiedStatus, NotificationOutcome, NotificationService } from "./notification.service.js";
import { notifyRepairConfirmed, notifyReportDecision, notifyReworkRequested } from "./notificationEvents.js";
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
  /** The automatic analysis failed and can be run again. */
  retryAnalysis: boolean;
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
  location: { verificationStatus: LocationVerificationStatus; needsReview: boolean; latitude: number; longitude: number };
  assignment: { engineer: PersonRef | null; repairStatus: RepairStatus | null; currentAttempt: number | null };
  image: ReportImageView | null;
}

export interface AdminReportListQuery {
  page: number;
  pageSize: number;
  /**
   * newest / oldest: by submission date.
   * severity: highest effective severity first (admin correction, else the estimate), then the
   *           longest waiting within each level; reports without a severity come last.
   * waiting:  longest waiting first. Without a status filter only reports that are still open
   *           (submitted, under review, delayed, accepted) are listed.
   */
  sort: "newest" | "oldest" | "severity" | "waiting";
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

export interface PossibleDuplicates {
  /** The rule that was applied, so the interface can explain the hint. */
  criteria: { radiusMeters: number; windowDays: number };
  matches: (AdminReportListItem & { distanceMeters: number })[];
}

export interface RetryAnalysisResult {
  report: AdminReportView;
  /** completed: detections and estimate are now stored. failed: the report is unchanged apart from the latest error. */
  analysis: "completed" | "failed";
}

export interface AdminReportService {
  list(query: AdminReportListQuery): Promise<{ items: AdminReportListItem[]; page: number; pageSize: number; total: number }>;
  /**
   * Reports for the admin overview map: the same filters as the list, newest first, capped at
   * ADMIN_MAP_MAX_POINTS. `truncated` tells the admin when more reports match than are shown.
   */
  mapPoints(query: AdminReportListQuery): Promise<{ points: AdminReportListItem[]; total: number; truncated: boolean }>;
  /** Read-only: opening a report never changes its status. */
  get(reportId: string): Promise<AdminReportView>;
  /**
   * Other reports close to this one in place and time. Read-only and advisory: reports are never
   * merged, rejected or blocked because of it.
   */
  possibleDuplicates(reportId: string): Promise<PossibleDuplicates>;
  /**
   * Runs the automatic analysis again for a report whose analysis FAILED. Only the ai_* fields
   * and detections are written; the status, the admin's severity and every decision are untouched.
   */
  retryAnalysis(adminId: string, reportId: string): Promise<RetryAnalysisResult>;
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
  latitude: true,
  longitude: true,
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
  ai: AiClient;
  storage: FileStorage;
}): AdminReportService {
  const { prisma, notifications, clock, ai, storage } = deps;
  /** Reports being re-analysed right now (this process): a second click is refused, not queued. */
  const retrying = new Set<string>();

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
      select: { status: true, repairStatus: true, repairAttempt: true, citizenId: true, assignedEngineerId: true, citizen: { select: { mobileNumber: true } } },
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

  /**
   * Highest effective severity first. The effective severity (admin correction, else the estimate)
   * is not a column, so the list is read as four consecutive groups (HIGH, MEDIUM, LOW, none),
   * each ordered by longest waiting, and the requested page is cut out of that sequence. Only the
   * Prisma query API is used, so the configured schema is respected.
   */
  const listBySeverity = async (query: AdminReportListQuery) => {
    const filters = buildListWhere(query);
    const groups: Prisma.ReportWhereInput[] = [
      { AND: [filters, severityWhere("HIGH")] },
      { AND: [filters, severityWhere("MEDIUM")] },
      { AND: [filters, severityWhere("LOW")] },
      { AND: [filters, { adminSeverity: null, aiSeverity: null }] },
    ];
    const counts = await Promise.all(groups.map((where) => prisma.report.count({ where })));
    const total = counts.reduce((sum, count) => sum + count, 0);
    let skip = (query.page - 1) * query.pageSize;
    let remaining = query.pageSize;
    const rows: AdminListRow[] = [];
    for (const [index, where] of groups.entries()) {
      const count = counts[index] ?? 0;
      if (remaining === 0) break;
      if (skip >= count) {
        skip -= count;
        continue;
      }
      const part = await prisma.report.findMany({ where, select: adminListSelect, orderBy: [{ createdAt: "asc" }, { id: "asc" }], skip, take: remaining });
      rows.push(...part);
      remaining -= part.length;
      skip = 0;
    }
    return { items: rows.map(toAdminListItem), page: query.page, pageSize: query.pageSize, total };
  };

  return {
    list: async (query) => {
      if (query.sort === "severity") {
        return listBySeverity(query);
      }
      const filters = buildListWhere(query);
      const where: Prisma.ReportWhereInput =
        query.sort === "waiting" && query.status === undefined ? { AND: [filters, { status: { in: [...OPEN_STATUSES] } }] } : filters;
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

    mapPoints: async (query) => {
      const where = buildListWhere(query);
      const [rows, total] = await Promise.all([
        prisma.report.findMany({ where, select: adminListSelect, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: ADMIN_MAP_MAX_POINTS }),
        prisma.report.count({ where }),
      ]);
      return { points: rows.map(toAdminListItem), total, truncated: total > rows.length };
    },

    get: load,

    possibleDuplicates: async (reportId) => {
      const report = await prisma.report.findUnique({ where: { id: reportId }, select: { latitude: true, longitude: true, createdAt: true } });
      if (report === null) {
        throw reportNotFound();
      }
      const origin = { latitude: report.latitude, longitude: report.longitude };
      // A bounding box narrows the candidates in the database; the exact distance is checked below.
      const latitudeMargin = DUPLICATE_HINT_RADIUS_METERS / 111_320;
      const longitudeMargin = latitudeMargin / Math.max(0.01, Math.cos((origin.latitude * Math.PI) / 180));
      const windowMs = DUPLICATE_HINT_WINDOW_DAYS * 86_400_000;
      const candidates = await prisma.report.findMany({
        where: {
          id: { not: reportId },
          latitude: { gte: origin.latitude - latitudeMargin, lte: origin.latitude + latitudeMargin },
          longitude: { gte: origin.longitude - longitudeMargin, lte: origin.longitude + longitudeMargin },
          createdAt: { gte: new Date(report.createdAt.getTime() - windowMs), lte: new Date(report.createdAt.getTime() + windowMs) },
        },
        select: adminListSelect,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: 200,
      });
      const matches = candidates
        .map((row) => ({ ...toAdminListItem(row), distanceMeters: haversineMeters(origin, { latitude: row.latitude, longitude: row.longitude }) }))
        .filter((match) => match.distanceMeters <= DUPLICATE_HINT_RADIUS_METERS)
        .sort((a, b) => a.distanceMeters - b.distanceMeters)
        .slice(0, DUPLICATE_HINT_MAX_RESULTS);
      return { criteria: { radiusMeters: DUPLICATE_HINT_RADIUS_METERS, windowDays: DUPLICATE_HINT_WINDOW_DAYS }, matches };
    },

    retryAnalysis: async (adminId, reportId) => {
      const report = await prisma.report.findUnique({
        where: { id: reportId },
        select: { aiStatus: true, aiErrorCode: true, images: { select: { id: true, displayKey: true, width: true, height: true }, take: 1 } },
      });
      if (report === null) {
        throw reportNotFound();
      }
      if (report.aiStatus !== "FAILED") {
        throw new HttpError(409, "ANALYSIS_NOT_RETRYABLE", "Only a report whose automatic analysis failed can be analysed again.");
      }
      const image = report.images[0];
      if (image === undefined) {
        throw new HttpError(409, "ANALYSIS_NOT_RETRYABLE", "This report has no photo to analyse.");
      }
      if (retrying.has(reportId)) {
        throw new HttpError(409, "ANALYSIS_IN_PROGRESS", "This report is already being analysed. Please wait.");
      }
      retrying.add(reportId);
      try {
        let failure: AiErrorKind | undefined;
        let analysis: Awaited<ReturnType<AiClient["analyze"]>> | undefined;
        try {
          // The same metadata-free display copy that was sent at submission.
          analysis = await ai.analyze(await storage.read(image.displayKey), "image/jpeg");
          if (analysis.image.width !== image.width || analysis.image.height !== image.height) {
            throw new AiServiceError("invalid_response", "AI service analysed an image of a different size");
          }
        } catch (error) {
          failure = error instanceof AiServiceError ? error.kind : "invalid_response";
        }

        if (analysis === undefined || failure !== undefined) {
          // Still failed: remember the latest reason. Nothing else about the report changes.
          await prisma.report.updateMany({ where: { id: reportId, aiStatus: "FAILED" }, data: { aiErrorCode: failure ?? "invalid_response" } });
          logger.warn("ai_analysis_retry", { reportId, adminId, outcome: "failed", kind: failure, previousError: report.aiErrorCode });
          return { report: await load(reportId), analysis: "failed" };
        }

        const result = analysis;
        const detections = toDetectionRows(result.detections, image.width, image.height);
        const severity = estimateSeverity(detections);
        await prisma.$transaction(async (tx) => {
          // Only while it is still FAILED: a concurrent retry (another server process) matches 0 rows.
          const updated = await tx.report.updateMany({
            where: { id: reportId, aiStatus: "FAILED" },
            data: {
              aiStatus: "COMPLETED",
              aiErrorCode: null,
              aiModel: result.model.name,
              aiAnalyzedAt: clock(),
              // Only the automatic estimate. admin_severity and the report status are never touched here.
              aiSeverity: severity.level,
              aiSeverityScore: severity.level === null ? null : severity.score,
            },
          });
          if (updated.count !== 1) {
            throw stateConflict();
          }
          if (detections.length > 0) {
            await tx.aiDetection.createMany({ data: detections.map((d) => ({ ...d, reportId, imageId: image.id })) });
          }
        });
        logger.info("ai_analysis_retry", { reportId, adminId, outcome: "completed", detections: detections.length, previousError: report.aiErrorCode });
        return { report: await load(reportId), analysis: "completed" };
      } finally {
        retrying.delete(reportId);
      }
    },

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
        const history = await tx.reportStatusHistory.create({
          data: { reportId, fromStatus: from, toStatus: to, changedById: adminId, note: note ?? null },
          select: { id: true },
        });
        await notifyReportDecision(tx, { reportId, citizenId: state.citizenId, from, to, reason: note, historyId: history.id });
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
        const update = await tx.repairUpdate.create({
          data: { reportId, authorId: adminId, kind: "ADMIN_FEEDBACK", attempt: expectedAttempt, note: note.trim() },
          select: { id: true },
        });
        await notifyReworkRequested(tx, { reportId, engineerId: state.assignedEngineerId, note: note.trim(), updateId: update.id });
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
        const history = await tx.reportStatusHistory.create({
          data: {
            reportId,
            fromStatus: "ACCEPTED",
            toStatus: "COMPLETED",
            changedById: adminId,
            note: `Repair attempt ${expectedAttempt} confirmed.${extra ? ` ${extra}` : ""}`,
          },
          select: { id: true },
        });
        await notifyRepairConfirmed(tx, {
          reportId,
          citizenId: state.citizenId,
          engineerId: state.assignedEngineerId,
          attempt: expectedAttempt,
          historyId: history.id,
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
    location: { verificationStatus: row.locationStatus, needsReview: row.locationNeedsReview, latitude: row.latitude, longitude: row.longitude },
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
      retryAnalysis: row.aiStatus === "FAILED",
    },
  };
}

import type { PrismaClient } from "../db/prisma.js";
import type {
  AccountStatus,
  LocationVerificationStatus,
  Prisma,
  RepairStatus,
  ReportStatus,
  SeverityLevel,
} from "../generated/prisma/client.js";
import { HttpError } from "../utils/httpError.js";
import { effectiveSeverity } from "./reportWorkflow.js";

/**
 * Admin analytics (Phase 5). Every figure is counted from real rows of `reports` (one report is
 * counted once per chart) and every chart uses the same date range on the report submission date.
 *
 * - Repair figures come from the report's CURRENT state (status, repair_status, assigned engineer),
 *   never from report_assignments / repair_updates, so repair attempts cannot inflate any count.
 * - Damage classes count DISTINCT reports per class: a photo with three potholes counts once.
 * - Severity is the effective severity: admin_severity ?? ai_severity.
 * - Only the Prisma query API is used (no raw SQL), so the configured schema is always respected.
 *   The time series reads one timestamp per report and groups it here, which is fine at FYP scale.
 */

export type Granularity = "day" | "week" | "month";

export interface AnalyticsQuery {
  /** YYYY-MM-DD (UTC), inclusive. */
  from?: string | undefined;
  /** YYYY-MM-DD (UTC), inclusive. */
  to?: string | undefined;
  granularity?: Granularity | undefined;
}

export interface EngineerWorkload {
  engineerId: string;
  fullName: string;
  status: AccountStatus;
  /** ACCEPTED with the current attempt Pending or Working. */
  open: number;
  /** ACCEPTED with the current attempt Completed, waiting for an admin. */
  awaitingConfirmation: number;
  /** Report COMPLETED (confirmed) while assigned to this engineer. */
  completed: number;
}

export interface AdminAnalytics {
  range: { from: string | null; to: string | null; granularity: Granularity };
  total: number;
  /** Reports submitted per period (periods with no reports are included with 0). */
  overTime: { period: string; count: number }[];
  byStatus: Record<ReportStatus, number>;
  bySeverity: Record<SeverityLevel | "NONE", number>;
  damageClasses: {
    /** Number of reports with at least one detection of the class (sorted, most first). */
    byClass: { className: string; reports: number }[];
    /** AI analysis succeeded but found nothing. */
    noDetections: number;
    /** AI analysis failed (no detections are stored). */
    aiFailed: number;
  };
  /** Accepted and completed reports by where their repair stands. */
  repairProgress: { unassigned: number; pending: number; working: number; awaitingConfirmation: number; completed: number };
  engineerWorkload: EngineerWorkload[];
  location: {
    byStatus: { status: LocationVerificationStatus; reports: number; needsReview: number }[];
    /** Reports flagged for an admin to check the location (mismatch, no metadata, poor GPS). */
    needsReview: number;
  };
}

export interface AnalyticsService {
  get(query: AnalyticsQuery): Promise<AdminAnalytics>;
}

const REPORT_STATUSES: readonly ReportStatus[] = ["SUBMITTED", "UNDER_REVIEW", "ACCEPTED", "REJECTED", "DELAYED", "COMPLETED"];
const LOCATION_STATUSES: readonly LocationVerificationStatus[] = ["VERIFIED", "MISMATCH", "NO_METADATA", "NOT_CHECKED", "BROWSER_GPS"];
const DAY_MS = 86_400_000;
/** Upper bound on points in the time series (keeps responses small whatever range is asked for). */
const MAX_PERIODS = 1000;

// ---------------------------------------------------------------------------
// Date helpers (UTC)
// ---------------------------------------------------------------------------

function dayStart(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Start of the period that contains `date`. Weeks start on Monday (ISO). */
export function periodStart(date: Date, granularity: Granularity): Date {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  if (granularity === "day") return day;
  if (granularity === "week") return new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY_MS);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function nextPeriod(start: Date, granularity: Granularity): Date {
  if (granularity === "day") return new Date(start.getTime() + DAY_MS);
  if (granularity === "week") return new Date(start.getTime() + 7 * DAY_MS);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
}

/** Day buckets up to ~2 months, week buckets up to ~1 year, month buckets beyond. */
export function defaultGranularity(first: Date, last: Date): Granularity {
  const days = (last.getTime() - first.getTime()) / DAY_MS + 1;
  if (days <= 62) return "day";
  if (days <= 366) return "week";
  return "month";
}

function periodCount(first: Date, last: Date, granularity: Granularity): number {
  const days = (last.getTime() - first.getTime()) / DAY_MS + 1;
  return Math.ceil(days / { day: 1, week: 7, month: 28 }[granularity]);
}

/** Counts per period from `first` to `last` (inclusive), filling empty periods with 0. */
export function bucketCounts(dates: readonly Date[], first: Date, last: Date, granularity: Granularity): { period: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const date of dates) {
    const key = isoDay(periodStart(date, granularity));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const series: { period: string; count: number }[] = [];
  const end = periodStart(last, granularity).getTime();
  // Bounded loop: at most a few thousand periods even for a very wide day range.
  for (let cursor = periodStart(first, granularity); cursor.getTime() <= end; cursor = nextPeriod(cursor, granularity)) {
    const key = isoDay(cursor);
    series.push({ period: key, count: counts.get(key) ?? 0 });
  }
  return series;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function createAnalyticsService(deps: { prisma: PrismaClient; clock: () => Date }): AnalyticsService {
  const { prisma, clock } = deps;

  return {
    get: async (query) => {
      const createdAt: Prisma.DateTimeFilter = {};
      if (query.from !== undefined) createdAt.gte = dayStart(query.from);
      // `to` is inclusive: everything before the start of the next day.
      if (query.to !== undefined) createdAt.lt = new Date(dayStart(query.to).getTime() + DAY_MS);
      const inRange: Prisma.ReportWhereInput = query.from === undefined && query.to === undefined ? {} : { createdAt };

      const [timestamps, statusGroups, severityGroups, classPairs, noDetections, aiFailed, repairGroups, workloadGroups, locationGroups] =
        await Promise.all([
          prisma.report.findMany({ where: inRange, select: { createdAt: true }, orderBy: { createdAt: "asc" } }),
          prisma.report.groupBy({ by: ["status"], where: inRange, _count: { _all: true } }),
          prisma.report.groupBy({ by: ["adminSeverity", "aiSeverity"], where: inRange, _count: { _all: true } }),
          // One row per (class, report) pair = distinct reports per class.
          prisma.aiDetection.groupBy({ by: ["className", "reportId"], where: { report: inRange } }),
          prisma.report.count({ where: { ...inRange, aiStatus: "COMPLETED", detections: { none: {} } } }),
          prisma.report.count({ where: { ...inRange, aiStatus: "FAILED" } }),
          prisma.report.groupBy({
            by: ["status", "repairStatus"],
            where: { ...inRange, status: { in: ["ACCEPTED", "COMPLETED"] } },
            _count: { _all: true },
          }),
          prisma.report.groupBy({
            by: ["assignedEngineerId", "status", "repairStatus"],
            where: { ...inRange, assignedEngineerId: { not: null } },
            _count: { _all: true },
          }),
          prisma.report.groupBy({ by: ["locationStatus", "locationNeedsReview"], where: inRange, _count: { _all: true } }),
        ]);

      // Time series
      // Range of the series: the requested dates; an open end runs to today (to) or to the first report (from).
      const dates = timestamps.map((row) => row.createdAt);
      const today = clock();
      const seriesLast = query.to !== undefined ? dayStart(query.to) : today;
      const seriesFirst = query.from !== undefined ? dayStart(query.from) : (dates[0] ?? seriesLast);
      const granularity = query.granularity ?? defaultGranularity(seriesFirst, seriesLast);
      if (periodCount(seriesFirst, seriesLast, granularity) > MAX_PERIODS) {
        throw new HttpError(400, "VALIDATION_ERROR", "Some fields are invalid.", {
          details: { fields: { granularity: [`Choose a shorter date range or a coarser granularity (at most ${MAX_PERIODS} periods).`] }, formErrors: [] },
        });
      }
      const overTime = seriesFirst.getTime() <= seriesLast.getTime() ? bucketCounts(dates, seriesFirst, seriesLast, granularity) : [];

      // Status
      const byStatus = Object.fromEntries(REPORT_STATUSES.map((s) => [s, 0])) as Record<ReportStatus, number>;
      let total = 0;
      for (const group of statusGroups) {
        byStatus[group.status] = group._count._all;
        total += group._count._all;
      }

      // Effective severity
      const bySeverity: Record<SeverityLevel | "NONE", number> = { LOW: 0, MEDIUM: 0, HIGH: 0, NONE: 0 };
      for (const group of severityGroups) {
        bySeverity[effectiveSeverity(group.adminSeverity, group.aiSeverity) ?? "NONE"] += group._count._all;
      }

      // Damage classes (class names come from the stored detections, i.e. from the model)
      const classCounts = new Map<string, number>();
      for (const pair of classPairs) {
        classCounts.set(pair.className, (classCounts.get(pair.className) ?? 0) + 1);
      }
      const byClass = [...classCounts]
        .map(([className, reports]) => ({ className, reports }))
        .sort((a, b) => b.reports - a.reports || a.className.localeCompare(b.className));

      // Repair progress (current state only)
      const repairProgress = { unassigned: 0, pending: 0, working: 0, awaitingConfirmation: 0, completed: 0 };
      for (const group of repairGroups) {
        const n = group._count._all;
        if (group.status === "COMPLETED") repairProgress.completed += n;
        else if (group.repairStatus === null) repairProgress.unassigned += n;
        else if (group.repairStatus === "PENDING") repairProgress.pending += n;
        else if (group.repairStatus === "WORKING") repairProgress.working += n;
        else repairProgress.awaitingConfirmation += n;
      }

      // Engineer workload: engineers with reports in the range, plus every active engineer (with zeros).
      const workload = new Map<string, Omit<EngineerWorkload, "engineerId" | "fullName" | "status">>();
      const bump = (engineerId: string, key: "open" | "awaitingConfirmation" | "completed", n: number): void => {
        const row = workload.get(engineerId) ?? { open: 0, awaitingConfirmation: 0, completed: 0 };
        row[key] += n;
        workload.set(engineerId, row);
      };
      for (const group of workloadGroups) {
        if (group.assignedEngineerId === null) continue;
        const key = workloadBucket(group.status, group.repairStatus);
        if (key !== null) bump(group.assignedEngineerId, key, group._count._all);
      }
      const engineers = await prisma.user.findMany({
        where: { role: "ENGINEER", OR: [{ status: "ACTIVE" }, { id: { in: [...workload.keys()] } }] },
        select: { id: true, fullName: true, status: true },
        orderBy: [{ fullName: "asc" }, { id: "asc" }],
      });
      const engineerWorkload = engineers.map((engineer) => ({
        engineerId: engineer.id,
        fullName: engineer.fullName,
        status: engineer.status,
        ...(workload.get(engineer.id) ?? { open: 0, awaitingConfirmation: 0, completed: 0 }),
      }));

      // Location verification
      const locationMap = new Map(LOCATION_STATUSES.map((status) => [status, { status, reports: 0, needsReview: 0 }]));
      let needsReview = 0;
      for (const group of locationGroups) {
        const row = locationMap.get(group.locationStatus);
        if (row === undefined) continue;
        row.reports += group._count._all;
        if (group.locationNeedsReview) {
          row.needsReview += group._count._all;
          needsReview += group._count._all;
        }
      }

      return {
        range: { from: query.from ?? null, to: query.to ?? null, granularity },
        total,
        overTime,
        byStatus,
        bySeverity,
        damageClasses: { byClass, noDetections, aiFailed },
        repairProgress,
        engineerWorkload,
        location: { byStatus: [...locationMap.values()], needsReview },
      };
    },
  };
}

function workloadBucket(status: ReportStatus, repairStatus: RepairStatus | null): "open" | "awaitingConfirmation" | "completed" | null {
  if (status === "COMPLETED") return "completed";
  if (status !== "ACCEPTED") return null;
  if (repairStatus === "PENDING" || repairStatus === "WORKING") return "open";
  if (repairStatus === "COMPLETED") return "awaitingConfirmation";
  return null;
}

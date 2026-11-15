/**
 * Shared Prisma selects and view mappers for reports (citizen views; admin and engineer views
 * build on the same helpers). Only the fields listed here ever leave the server.
 */
import type {
  AiAnalysisStatus,
  CaptureMethod,
  LocationVerificationStatus,
  Prisma,
  RepairStatus,
  ReportStatus,
  SeverityLevel,
} from "../generated/prisma/client.js";

export interface ReportImageView {
  id: string;
  /** Authorised API URL of the metadata-free display copy. */
  url: string;
  width: number;
  height: number;
}

export interface DetectionView {
  id: string;
  className: string;
  confidence: number;
  /** Pixels of the display image. */
  box: { x1: number; y1: number; x2: number; y2: number };
  areaFraction: number;
}

/**
 * Repair progress as citizens see it (no engineer identity, no attempts).
 * Null while the report is not accepted (or was rejected).
 */
export type RepairProgress = "NOT_ASSIGNED" | "SCHEDULED" | "IN_PROGRESS" | "AWAITING_CONFIRMATION" | "DONE";

/** What a citizen sees about their own report. No storage keys, EXIF coordinates or admin fields. */
export interface ReportView {
  id: string;
  status: ReportStatus;
  captureMethod: CaptureMethod;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Latest reason while the report is REJECTED or DELAYED (includes a newer "keep delayed" reason). */
  decisionReason: string | null;
  repairProgress: RepairProgress | null;
  location: {
    latitude: number;
    longitude: number;
    gpsAccuracyMeters: number | null;
    verificationStatus: LocationVerificationStatus;
    needsReview: boolean;
    exifDistanceMeters: number | null;
  };
  analysis: {
    status: AiAnalysisStatus;
    analyzedAt: Date | null;
    model: string | null;
    /** Heuristic estimate, not an engineering measurement. Null if no damage was detected or analysis failed. */
    estimatedSeverity: SeverityLevel | null;
    severityScore: number | null;
    detections: DetectionView[];
  };
  image: ReportImageView | null;
}

export interface ReportListItem {
  id: string;
  status: ReportStatus;
  captureMethod: CaptureMethod;
  description: string | null;
  createdAt: Date;
  repairProgress: RepairProgress | null;
  location: { latitude: number; longitude: number; verificationStatus: LocationVerificationStatus; needsReview: boolean };
  analysis: {
    status: AiAnalysisStatus;
    estimatedSeverity: SeverityLevel | null;
    detectionCount: number;
    damageClasses: string[];
  };
  image: ReportImageView | null;
}

const DECISION_REASON_STATUSES: ReportStatus[] = ["REJECTED", "DELAYED"];

export const imageSelect = { select: { id: true, width: true, height: true }, orderBy: { createdAt: "asc" } } satisfies Prisma.Report$imagesArgs;

export const detectionsSelect = {
  select: { id: true, className: true, confidence: true, x1: true, y1: true, x2: true, y2: true, areaFraction: true },
  orderBy: { confidence: "desc" },
} satisfies Prisma.Report$detectionsArgs;

/** Newest REJECTED/DELAYED history entry, for the citizen's decision reason. */
const latestDecisionSelect = {
  where: { toStatus: { in: DECISION_REASON_STATUSES } },
  orderBy: { createdAt: "desc" },
  take: 1,
  select: { toStatus: true, note: true },
} satisfies Prisma.Report$statusHistoryArgs;

export const reportDetailSelect = {
  id: true,
  status: true,
  captureMethod: true,
  description: true,
  latitude: true,
  longitude: true,
  gpsAccuracyM: true,
  locationStatus: true,
  locationNeedsReview: true,
  exifDistanceM: true,
  aiStatus: true,
  aiModel: true,
  aiAnalyzedAt: true,
  aiSeverity: true,
  aiSeverityScore: true,
  assignedEngineerId: true,
  repairStatus: true,
  createdAt: true,
  updatedAt: true,
  images: imageSelect,
  detections: detectionsSelect,
  statusHistory: latestDecisionSelect,
} satisfies Prisma.ReportSelect;

export const reportListSelect = {
  id: true,
  status: true,
  captureMethod: true,
  description: true,
  latitude: true,
  longitude: true,
  locationStatus: true,
  locationNeedsReview: true,
  aiStatus: true,
  aiSeverity: true,
  assignedEngineerId: true,
  repairStatus: true,
  createdAt: true,
  images: imageSelect,
  detections: { select: { className: true } },
} satisfies Prisma.ReportSelect;

type ReportDetailRow = Prisma.ReportGetPayload<{ select: typeof reportDetailSelect }>;
type ReportListRow = Prisma.ReportGetPayload<{ select: typeof reportListSelect }>;

export function reportImagePath(reportId: string, imageId: string): string {
  return `/api/v1/reports/${reportId}/images/${imageId}`;
}

export function imageView(reportId: string, image: { id: string; width: number; height: number } | undefined): ReportImageView | null {
  return image === undefined ? null : { id: image.id, url: reportImagePath(reportId, image.id), width: image.width, height: image.height };
}

export function detectionViews(
  rows: readonly { id: string; className: string; confidence: number; x1: number; y1: number; x2: number; y2: number; areaFraction: number }[],
): DetectionView[] {
  return rows.map((d) => ({
    id: d.id,
    className: d.className,
    confidence: d.confidence,
    box: { x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2 },
    areaFraction: d.areaFraction,
  }));
}

export function repairProgress(
  status: ReportStatus,
  assignedEngineerId: string | null,
  repairStatus: RepairStatus | null,
): RepairProgress | null {
  if (status === "COMPLETED") return "DONE";
  if (status !== "ACCEPTED") return null;
  if (assignedEngineerId === null || repairStatus === null) return "NOT_ASSIGNED";
  switch (repairStatus) {
    case "PENDING":
      return "SCHEDULED";
    case "WORKING":
      return "IN_PROGRESS";
    case "COMPLETED":
      return "AWAITING_CONFIRMATION";
  }
}

export function toReportView(row: ReportDetailRow): ReportView {
  const latest = row.statusHistory[0];
  return {
    id: row.id,
    status: row.status,
    captureMethod: row.captureMethod,
    description: row.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    // Only while the report is still in that state (an old delay reason is hidden after acceptance).
    decisionReason: latest !== undefined && latest.toStatus === row.status ? latest.note : null,
    repairProgress: repairProgress(row.status, row.assignedEngineerId, row.repairStatus),
    location: {
      latitude: row.latitude,
      longitude: row.longitude,
      gpsAccuracyMeters: row.gpsAccuracyM,
      verificationStatus: row.locationStatus,
      needsReview: row.locationNeedsReview,
      exifDistanceMeters: row.exifDistanceM,
    },
    analysis: {
      status: row.aiStatus,
      analyzedAt: row.aiAnalyzedAt,
      model: row.aiModel,
      estimatedSeverity: row.aiSeverity,
      severityScore: row.aiSeverityScore,
      detections: detectionViews(row.detections),
    },
    image: imageView(row.id, row.images[0]),
  };
}

export function toReportListItem(row: ReportListRow): ReportListItem {
  return {
    id: row.id,
    status: row.status,
    captureMethod: row.captureMethod,
    description: row.description,
    createdAt: row.createdAt,
    repairProgress: repairProgress(row.status, row.assignedEngineerId, row.repairStatus),
    location: {
      latitude: row.latitude,
      longitude: row.longitude,
      verificationStatus: row.locationStatus,
      needsReview: row.locationNeedsReview,
    },
    analysis: {
      status: row.aiStatus,
      estimatedSeverity: row.aiSeverity,
      detectionCount: row.detections.length,
      damageClasses: [...new Set(row.detections.map((d) => d.className))].sort(),
    },
    image: imageView(row.id, row.images[0]),
  };
}

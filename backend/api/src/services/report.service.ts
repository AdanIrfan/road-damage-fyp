import { createHash } from "node:crypto";
import type { PrismaClient } from "../db/prisma.js";
import type {
  AiAnalysisStatus,
  CaptureMethod,
  LocationVerificationStatus,
  Prisma,
  ReportStatus,
  SeverityLevel,
} from "../generated/prisma/client.js";
import { HttpError } from "../utils/httpError.js";
import { AiServiceError, type AiAnalysis, type AiClient, type AiErrorKind } from "./ai/aiClient.js";
import type { Clock } from "./clock.js";
import { detectImageType } from "./images/detectImageType.js";
import { createDisplayCopy, type DisplayImage } from "./images/processImage.js";
import { readExifGps } from "./location/exifGps.js";
import { verifyGalleryLocation, verifyLiveLocation, type LocationCheck } from "./location/verifyLocation.js";
import { estimateSeverity } from "./severity.js";
import type { FileStorage } from "./storage/fileStorage.js";
import type { PublicUser } from "./user.service.js";

export interface ReportLocationSettings {
  exifLocationToleranceKm: number;
  gpsAccuracyThresholdMeters: number;
}

export interface CreateReportInput {
  captureMethod: CaptureMethod;
  latitude: number;
  longitude: number;
  gpsAccuracyMeters?: number | undefined;
  description?: string | undefined;
}

export interface ReportListQuery {
  status?: ReportStatus | undefined;
  sort: "newest" | "oldest";
  page: number;
  pageSize: number;
}

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

/** What a citizen sees about their own report. No storage keys, EXIF coordinates or admin fields. */
export interface ReportView {
  id: string;
  status: ReportStatus;
  captureMethod: CaptureMethod;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
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
  location: { latitude: number; longitude: number; verificationStatus: LocationVerificationStatus; needsReview: boolean };
  analysis: {
    status: AiAnalysisStatus;
    estimatedSeverity: SeverityLevel | null;
    detectionCount: number;
    damageClasses: string[];
  };
  image: ReportImageView | null;
}

export interface ReportList {
  items: ReportListItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ReportSummary {
  total: number;
  byStatus: Record<ReportStatus, number>;
}

export interface ReportService {
  /** Validates and stores the photo, runs the AI analysis and saves the report (status SUBMITTED). */
  create(citizenId: string, input: CreateReportInput, upload: Buffer): Promise<ReportView>;
  listForCitizen(citizenId: string, query: ReportListQuery): Promise<ReportList>;
  getForCitizen(citizenId: string, reportId: string): Promise<ReportView>;
  summaryForCitizen(citizenId: string): Promise<ReportSummary>;
  /** Display copy of a report image: citizens only their own reports, admins any report. */
  getImage(user: PublicUser, reportId: string, imageId: string): Promise<Buffer>;
}

export interface ReportServiceDependencies {
  prisma: PrismaClient;
  ai: AiClient;
  storage: FileStorage;
  clock: Clock;
  location: ReportLocationSettings;
}

const REPORT_STATUS_VALUES: readonly ReportStatus[] = ["SUBMITTED", "UNDER_REVIEW", "ACCEPTED", "REJECTED", "DELAYED", "COMPLETED"];

const reportNotFound = (): HttpError => new HttpError(404, "REPORT_NOT_FOUND", "Report not found.");

const reportDetailSelect = {
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
  createdAt: true,
  updatedAt: true,
  images: { select: { id: true, width: true, height: true }, orderBy: { createdAt: "asc" } },
  detections: {
    select: { id: true, className: true, confidence: true, x1: true, y1: true, x2: true, y2: true, areaFraction: true },
    orderBy: { confidence: "desc" },
  },
} satisfies Prisma.ReportSelect;

const reportListSelect = {
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
  createdAt: true,
  images: { select: { id: true, width: true, height: true }, orderBy: { createdAt: "asc" } },
  detections: { select: { className: true } },
} satisfies Prisma.ReportSelect;

type ReportDetailRow = Prisma.ReportGetPayload<{ select: typeof reportDetailSelect }>;
type ReportListRow = Prisma.ReportGetPayload<{ select: typeof reportListSelect }>;

type AnalysisOutcome =
  | { ok: true; analysis: AiAnalysis }
  | { ok: false; kind: AiErrorKind };

export function createReportService(deps: ReportServiceDependencies): ReportService {
  const { prisma, ai, storage, clock, location } = deps;

  const analyse = async (display: DisplayImage): Promise<AnalysisOutcome> => {
    try {
      const analysis = await ai.analyze(display.data, "image/jpeg");
      if (analysis.image.width !== display.width || analysis.image.height !== display.height) {
        // Boxes would not line up with the stored image.
        throw new AiServiceError("invalid_response", "AI service analysed an image of a different size");
      }
      return { ok: true, analysis };
    } catch (error) {
      const kind: AiErrorKind = error instanceof AiServiceError ? error.kind : "invalid_response";
      // Never log the image or the coordinates; the kind is enough to diagnose.
      console.warn(`AI analysis failed (${kind}): ${error instanceof Error ? error.message : "unknown error"}`);
      return { ok: false, kind };
    }
  };

  const checkLocation = async (input: CreateReportInput, original: Buffer): Promise<LocationCheck & { exif: { latitude: number; longitude: number } | null }> => {
    if (input.captureMethod === "LIVE_CAMERA") {
      // Validated by the request schema: live camera reports always carry an accuracy.
      const accuracy = input.gpsAccuracyMeters ?? Number.POSITIVE_INFINITY;
      return { ...verifyLiveLocation(accuracy, location.gpsAccuracyThresholdMeters), exif: null };
    }
    const exif = await readExifGps(original);
    return {
      ...verifyGalleryLocation({ latitude: input.latitude, longitude: input.longitude }, exif, location.exifLocationToleranceKm),
      exif,
    };
  };

  const getDetail = async (where: Prisma.ReportWhereInput): Promise<ReportView> => {
    const row = await prisma.report.findFirst({ where, select: reportDetailSelect });
    if (row === null) {
      throw reportNotFound();
    }
    return toReportView(row);
  };

  return {
    create: async (citizenId, input, upload) => {
      const mimeType = detectImageType(upload);
      if (mimeType === null) {
        throw new HttpError(415, "UNSUPPORTED_IMAGE_TYPE", "Only JPEG and PNG photos are supported.");
      }
      const display = await createDisplayCopy(upload);
      const locationCheck = await checkLocation(input, upload);

      const savedKeys: string[] = [];
      try {
        const originalKey = await storage.save("originals", upload, mimeType === "image/png" ? "png" : "jpg");
        savedKeys.push(originalKey);
        const displayKey = await storage.save("display", display.data, "jpg");
        savedKeys.push(displayKey);

        const outcome = await analyse(display);
        const imageArea = display.width * display.height;
        const detections = outcome.ok
          ? outcome.analysis.detections.map((d) => ({
              classId: d.classId,
              className: d.className,
              confidence: d.confidence,
              x1: d.box.x1,
              y1: d.box.y1,
              x2: d.box.x2,
              y2: d.box.y2,
              areaFraction: Math.min(1, Math.max(0, ((d.box.x2 - d.box.x1) * (d.box.y2 - d.box.y1)) / imageArea)),
            }))
          : [];
        const severity = outcome.ok ? estimateSeverity(detections) : null;

        const reportId = await prisma.$transaction(async (tx) => {
          const report = await tx.report.create({
            data: {
              citizenId,
              status: "SUBMITTED",
              captureMethod: input.captureMethod,
              description: input.description ?? null,
              latitude: input.latitude,
              longitude: input.longitude,
              gpsAccuracyM: input.captureMethod === "LIVE_CAMERA" ? (input.gpsAccuracyMeters ?? null) : null,
              locationStatus: locationCheck.status,
              locationNeedsReview: locationCheck.needsReview,
              exifLatitude: locationCheck.exif?.latitude ?? null,
              exifLongitude: locationCheck.exif?.longitude ?? null,
              exifDistanceM: locationCheck.distanceMeters,
              aiStatus: outcome.ok ? "COMPLETED" : "FAILED",
              aiErrorCode: outcome.ok ? null : outcome.kind,
              aiModel: outcome.ok ? outcome.analysis.model.name : null,
              aiAnalyzedAt: outcome.ok ? clock() : null,
              aiSeverity: severity?.level ?? null,
              aiSeverityScore: severity === null || severity.level === null ? null : severity.score,
              images: {
                create: {
                  originalKey,
                  displayKey,
                  mimeType,
                  sizeBytes: upload.length,
                  width: display.width,
                  height: display.height,
                  sha256: createHash("sha256").update(upload).digest("hex"),
                },
              },
              statusHistory: { create: { fromStatus: null, toStatus: "SUBMITTED", changedById: citizenId } },
            },
            select: { id: true, images: { select: { id: true } } },
          });
          const imageId = report.images[0]?.id;
          if (imageId === undefined) {
            throw new Error("Report image was not created");
          }
          if (detections.length > 0) {
            await tx.aiDetection.createMany({
              data: detections.map((d) => ({ ...d, reportId: report.id, imageId })),
            });
          }
          return report.id;
        });

        return await getDetail({ id: reportId, citizenId });
      } catch (error) {
        // Do not leave orphaned files behind when the report could not be saved.
        await Promise.all(savedKeys.map((key) => storage.delete(key).catch(() => undefined)));
        throw error;
      }
    },

    listForCitizen: async (citizenId, { status, sort, page, pageSize }) => {
      const where: Prisma.ReportWhereInput = { citizenId, ...(status === undefined ? {} : { status }) };
      const [rows, total] = await prisma.$transaction([
        prisma.report.findMany({
          where,
          select: reportListSelect,
          orderBy: [{ createdAt: sort === "newest" ? "desc" : "asc" }, { id: "asc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.report.count({ where }),
      ]);
      return { items: rows.map(toReportListItem), page, pageSize, total };
    },

    // Another citizen's report gives the same 404 as a missing one, so ids cannot be probed.
    getForCitizen: (citizenId, reportId) => getDetail({ id: reportId, citizenId }),

    summaryForCitizen: async (citizenId) => {
      const groups = await prisma.report.groupBy({ by: ["status"], where: { citizenId }, _count: { _all: true } });
      const byStatus = Object.fromEntries(REPORT_STATUS_VALUES.map((s) => [s, 0])) as Record<ReportStatus, number>;
      let total = 0;
      for (const group of groups) {
        byStatus[group.status] = group._count._all;
        total += group._count._all;
      }
      return { total, byStatus };
    },

    getImage: async (user, reportId, imageId) => {
      if (user.role !== "CITIZEN" && user.role !== "ADMIN") {
        throw new HttpError(403, "FORBIDDEN", "You do not have permission to do this.");
      }
      const image = await prisma.reportImage.findFirst({
        where: { id: imageId, reportId, ...(user.role === "ADMIN" ? {} : { report: { citizenId: user.id } }) },
        select: { displayKey: true },
      });
      if (image === null) {
        throw new HttpError(404, "IMAGE_NOT_FOUND", "Image not found.");
      }
      return storage.read(image.displayKey);
    },
  };
}

function imageView(reportId: string, image: { id: string; width: number; height: number } | undefined): ReportImageView | null {
  if (image === undefined) {
    return null;
  }
  return { id: image.id, url: `/api/v1/reports/${reportId}/images/${image.id}`, width: image.width, height: image.height };
}

function toReportView(row: ReportDetailRow): ReportView {
  return {
    id: row.id,
    status: row.status,
    captureMethod: row.captureMethod,
    description: row.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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
      detections: row.detections.map((d) => ({
        id: d.id,
        className: d.className,
        confidence: d.confidence,
        box: { x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2 },
        areaFraction: d.areaFraction,
      })),
    },
    image: imageView(row.id, row.images[0]),
  };
}

function toReportListItem(row: ReportListRow): ReportListItem {
  return {
    id: row.id,
    status: row.status,
    captureMethod: row.captureMethod,
    description: row.description,
    createdAt: row.createdAt,
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

import { createHash } from "node:crypto";
import { MAX_REPAIR_PHOTOS_PER_ATTEMPT, MIN_REPAIR_PHOTOS_TO_COMPLETE } from "../config/workflow.js";
import type { PrismaClient } from "../db/prisma.js";
import type { AiAnalysisStatus, Prisma, RepairStatus, ReportStatus, SeverityLevel } from "../generated/prisma/client.js";
import { HttpError } from "../utils/httpError.js";
import { stateConflict } from "./adminReport.service.js";
import type { Clock } from "./clock.js";
import { detectImageType } from "./images/detectImageType.js";
import { createDisplayCopy } from "./images/processImage.js";
import {
  assignmentHistorySelect,
  buildRepairAttempts,
  repairPhotosSelect,
  repairPhotoView,
  repairUpdatesSelect,
  type RepairAttemptView,
  type RepairPhotoView,
} from "./repairViews.js";
import { canUploadRepairPhoto, effectiveSeverity, repairTransition, type RepairTarget } from "./reportWorkflow.js";
import { detectionsSelect, detectionViews, imageSelect, imageView, type DetectionView, type ReportImageView } from "./reportViews.js";
import type { FileStorage } from "./storage/fileStorage.js";
import type { PublicUser } from "./user.service.js";

/** What an engineer sees about a job. No citizen identity, no EXIF coordinates. */
export interface EngineerJobView {
  id: string;
  status: ReportStatus;
  description: string | null;
  createdAt: Date;
  assignedAt: Date | null;
  location: { latitude: number; longitude: number; gpsAccuracyMeters: number | null };
  severity: { ai: SeverityLevel | null; admin: SeverityLevel | null; effective: SeverityLevel | null };
  analysis: { status: AiAnalysisStatus; detections: DetectionView[] };
  image: ReportImageView | null;
  repair: {
    status: RepairStatus | null;
    statusUpdatedAt: Date | null;
    currentAttempt: number | null;
    currentAttemptPhotoCount: number;
    maxPhotosPerAttempt: number;
    canUploadPhotos: boolean;
    /** Repair statuses the engineer may move to right now. */
    allowedTransitions: RepairTarget[];
    /** Latest "needs more work" note on the current attempt, if any. */
    latestFeedback: { note: string | null; createdAt: Date } | null;
  };
  attempts: RepairAttemptView[];
}

export interface EngineerJobListItem {
  id: string;
  status: ReportStatus;
  description: string | null;
  createdAt: Date;
  assignedAt: Date | null;
  repairStatus: RepairStatus | null;
  currentAttempt: number | null;
  severity: SeverityLevel | null;
  damageClasses: string[];
  /** Admin asked for more work on the current (Completed) attempt. */
  needsMoreWork: boolean;
  image: ReportImageView | null;
}

export interface EngineerJobService {
  summary(engineerId: string): Promise<{ active: number; awaitingConfirmation: number; completed: number; needsMoreWork: number }>;
  list(
    engineerId: string,
    query: { scope: "active" | "history"; page: number; pageSize: number },
  ): Promise<{ items: EngineerJobListItem[]; page: number; pageSize: number; total: number }>;
  get(engineerId: string, reportId: string): Promise<EngineerJobView>;
  setRepairStatus(
    engineerId: string,
    reportId: string,
    input: { status: RepairTarget; expectedAttempt: number; note?: string | undefined },
  ): Promise<EngineerJobView>;
  addNote(engineerId: string, reportId: string, input: { note: string; expectedAttempt: number }): Promise<EngineerJobView>;
  addPhoto(
    engineerId: string,
    reportId: string,
    expectedAttempt: number,
    upload: Buffer,
  ): Promise<{ photo: RepairPhotoView; currentAttemptPhotoCount: number }>;
  /** Display copy of a repair photo: admins any; engineers only for jobs currently assigned to them. */
  getRepairPhoto(user: PublicUser, reportId: string, photoId: string): Promise<Buffer>;
}

const jobNotFound = (): HttpError => new HttpError(404, "JOB_NOT_FOUND", "Job not found.");
const invalidTransition = (message: string): HttpError => new HttpError(409, "INVALID_TRANSITION", message);

const jobDetailSelect = {
  id: true,
  status: true,
  description: true,
  createdAt: true,
  assignedAt: true,
  latitude: true,
  longitude: true,
  gpsAccuracyM: true,
  aiSeverity: true,
  adminSeverity: true,
  aiStatus: true,
  repairStatus: true,
  repairStatusUpdatedAt: true,
  repairAttempt: true,
  images: imageSelect,
  detections: detectionsSelect,
  assignments: assignmentHistorySelect,
  repairUpdates: repairUpdatesSelect,
  repairPhotos: repairPhotosSelect,
} satisfies Prisma.ReportSelect;

const jobListSelect = {
  id: true,
  status: true,
  description: true,
  createdAt: true,
  assignedAt: true,
  repairStatus: true,
  repairAttempt: true,
  aiSeverity: true,
  adminSeverity: true,
  images: imageSelect,
  detections: { select: { className: true } },
  repairUpdates: { orderBy: { createdAt: "desc" }, take: 1, select: { kind: true, attempt: true } },
} satisfies Prisma.ReportSelect;

type JobDetailRow = Prisma.ReportGetPayload<{ select: typeof jobDetailSelect }>;
type JobListRow = Prisma.ReportGetPayload<{ select: typeof jobListSelect }>;

/** A job is visible to an engineer only while it is assigned to them (open or completed). */
const ownJob = (engineerId: string, reportId?: string): Prisma.ReportWhereInput => ({
  ...(reportId === undefined ? {} : { id: reportId }),
  assignedEngineerId: engineerId,
  status: { in: ["ACCEPTED", "COMPLETED"] },
});

export function createEngineerJobService(deps: { prisma: PrismaClient; storage: FileStorage; clock: Clock }): EngineerJobService {
  const { prisma, storage, clock } = deps;

  const load = async (engineerId: string, reportId: string): Promise<EngineerJobView> => {
    const row = await prisma.report.findFirst({ where: ownJob(engineerId, reportId), select: jobDetailSelect });
    if (row === null) {
      throw jobNotFound();
    }
    return toJobView(row);
  };

  /** Current state of one of the engineer's jobs, checked against the attempt on their screen. */
  const openAttempt = async (engineerId: string, reportId: string, expectedAttempt: number) => {
    const row = await prisma.report.findFirst({
      where: ownJob(engineerId, reportId),
      select: { status: true, repairStatus: true, repairAttempt: true },
    });
    if (row === null) {
      throw jobNotFound();
    }
    if (row.status !== "ACCEPTED") {
      throw invalidTransition("This job is already completed.");
    }
    if (row.repairAttempt !== expectedAttempt) {
      throw stateConflict();
    }
    return row;
  };

  return {
    summary: async (engineerId) => {
      // Not an array $transaction: inside one, Prisma 7 loads relations in parallel on a single pg
      // connection (pg 8.23 deprecation, an error in pg 9). READ COMMITTED gives no snapshot anyway.
      const [active, awaitingConfirmation, completed, rows] = await Promise.all([
        prisma.report.count({ where: { assignedEngineerId: engineerId, status: "ACCEPTED", repairStatus: { in: ["PENDING", "WORKING"] } } }),
        prisma.report.count({ where: { assignedEngineerId: engineerId, status: "ACCEPTED", repairStatus: "COMPLETED" } }),
        prisma.report.count({ where: { assignedEngineerId: engineerId, status: "COMPLETED" } }),
        prisma.report.findMany({
          where: { assignedEngineerId: engineerId, status: "ACCEPTED", repairStatus: "COMPLETED" },
          select: { repairAttempt: true, repairUpdates: { orderBy: { createdAt: "desc" }, take: 1, select: { kind: true, attempt: true } } },
        }),
      ]);
      const needsMoreWork = rows.filter((r) => needsMoreWorkFlag("COMPLETED", r.repairAttempt, r.repairUpdates[0])).length;
      return { active, awaitingConfirmation, completed, needsMoreWork };
    },

    list: async (engineerId, { scope, page, pageSize }) => {
      const where: Prisma.ReportWhereInput =
        scope === "active" ? { assignedEngineerId: engineerId, status: "ACCEPTED" } : { assignedEngineerId: engineerId, status: "COMPLETED" };
      // Not an array $transaction: inside one, Prisma 7 loads relations in parallel on a single pg
      // connection (pg 8.23 deprecation, an error in pg 9). READ COMMITTED gives no snapshot anyway.
      const [rows, total] = await Promise.all([
        prisma.report.findMany({
          where,
          select: jobListSelect,
          orderBy: scope === "active" ? [{ assignedAt: "desc" }, { id: "asc" }] : [{ updatedAt: "desc" }, { id: "asc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.report.count({ where }),
      ]);
      return { items: rows.map(toJobListItem), page, pageSize, total };
    },

    get: load,

    setRepairStatus: async (engineerId, reportId, { status: target, expectedAttempt, note }) => {
      const state = await openAttempt(engineerId, reportId, expectedAttempt);
      const transition = repairTransition(state.repairStatus, target);
      if (!transition.allowed || state.repairStatus === null) {
        throw invalidTransition(`The repair cannot move from ${state.repairStatus ?? "unassigned"} to ${target}.`);
      }
      const from = state.repairStatus;
      const attempt = transition.startsNewAttempt ? expectedAttempt + 1 : expectedAttempt;
      await prisma.$transaction(async (tx) => {
        // Checks the state on the engineer's screen and locks the report row until commit.
        const updated = await tx.report.updateMany({
          where: { id: reportId, assignedEngineerId: engineerId, status: "ACCEPTED", repairStatus: from, repairAttempt: expectedAttempt },
          data: { repairStatus: target, repairStatusUpdatedAt: clock(), repairAttempt: attempt },
        });
        if (updated.count !== 1) {
          throw stateConflict();
        }
        if (transition.requiresCurrentAttemptPhoto) {
          // Counted after the row lock: only photos of THIS attempt count as evidence.
          const photos = await tx.repairPhoto.count({ where: { reportId, attempt: expectedAttempt } });
          if (photos < MIN_REPAIR_PHOTOS_TO_COMPLETE) {
            throw new HttpError(409, "REPAIR_PHOTO_REQUIRED", "Upload at least one photo of this repair attempt before marking it completed.");
          }
        }
        await tx.repairUpdate.create({
          data: { reportId, authorId: engineerId, kind: "STATUS_CHANGE", attempt, fromStatus: from, toStatus: target, note: note?.trim() || null },
        });
      });
      return load(engineerId, reportId);
    },

    addNote: async (engineerId, reportId, { note, expectedAttempt }) => {
      await openAttempt(engineerId, reportId, expectedAttempt);
      await prisma.$transaction(async (tx) => {
        const locked = await tx.report.updateMany({
          where: { id: reportId, assignedEngineerId: engineerId, status: "ACCEPTED", repairAttempt: expectedAttempt },
          data: { updatedAt: clock() },
        });
        if (locked.count !== 1) {
          throw stateConflict();
        }
        await tx.repairUpdate.create({ data: { reportId, authorId: engineerId, kind: "NOTE", attempt: expectedAttempt, note: note.trim() } });
      });
      return load(engineerId, reportId);
    },

    addPhoto: async (engineerId, reportId, expectedAttempt, upload) => {
      const state = await openAttempt(engineerId, reportId, expectedAttempt);
      if (!canUploadRepairPhoto(state.repairStatus)) {
        throw invalidTransition("Photos can only be added while the repair attempt is pending or in progress.");
      }
      const mimeType = detectImageType(upload);
      if (mimeType === null) {
        throw new HttpError(415, "UNSUPPORTED_IMAGE_TYPE", "Only JPEG and PNG photos are supported.");
      }
      const display = await createDisplayCopy(upload);

      const savedKeys: string[] = [];
      try {
        const originalKey = await storage.save("originals", upload, mimeType === "image/png" ? "png" : "jpg");
        savedKeys.push(originalKey);
        const displayKey = await storage.save("display", display.data, "jpg");
        savedKeys.push(displayKey);

        const result = await prisma.$transaction(async (tx) => {
          const locked = await tx.report.updateMany({
            where: {
              id: reportId,
              assignedEngineerId: engineerId,
              status: "ACCEPTED",
              repairAttempt: expectedAttempt,
              repairStatus: { in: ["PENDING", "WORKING"] },
            },
            data: { updatedAt: clock() },
          });
          if (locked.count !== 1) {
            throw stateConflict();
          }
          // Counted after the row lock, so parallel uploads can never exceed the per-attempt cap.
          const existing = await tx.repairPhoto.count({ where: { reportId, attempt: expectedAttempt } });
          if (existing >= MAX_REPAIR_PHOTOS_PER_ATTEMPT) {
            throw new HttpError(
              409,
              "REPAIR_PHOTO_LIMIT",
              `A repair attempt can have at most ${MAX_REPAIR_PHOTOS_PER_ATTEMPT} photos.`,
            );
          }
          const photo = await tx.repairPhoto.create({
            data: {
              reportId,
              uploadedById: engineerId,
              attempt: expectedAttempt,
              originalKey,
              displayKey,
              mimeType,
              sizeBytes: upload.length,
              width: display.width,
              height: display.height,
              sha256: createHash("sha256").update(upload).digest("hex"),
            },
            select: repairPhotosSelect.select,
          });
          return { photo: repairPhotoView(reportId, photo), currentAttemptPhotoCount: existing + 1 };
        });
        return result;
      } catch (error) {
        // Never leave orphaned files when the photo could not be recorded.
        await Promise.all(savedKeys.map((key) => storage.delete(key).catch(() => undefined)));
        throw error;
      }
    },

    getRepairPhoto: async (user, reportId, photoId) => {
      if (user.role !== "ADMIN" && user.role !== "ENGINEER") {
        throw new HttpError(403, "FORBIDDEN", "You do not have permission to do this.");
      }
      const photo = await prisma.repairPhoto.findFirst({
        where: { id: photoId, reportId, ...(user.role === "ADMIN" ? {} : { report: ownJob(user.id) }) },
        select: { displayKey: true },
      });
      if (photo === null) {
        throw new HttpError(404, "REPAIR_PHOTO_NOT_FOUND", "Photo not found.");
      }
      return storage.read(photo.displayKey);
    },
  };
}

function needsMoreWorkFlag(
  repairStatus: RepairStatus | null,
  currentAttempt: number | null,
  latestUpdate: { kind: string; attempt: number } | undefined,
): boolean {
  return repairStatus === "COMPLETED" && latestUpdate?.kind === "ADMIN_FEEDBACK" && latestUpdate.attempt === currentAttempt;
}

function allowedTransitions(status: ReportStatus, repairStatus: RepairStatus | null): RepairTarget[] {
  if (status !== "ACCEPTED") return [];
  return (["WORKING", "COMPLETED"] as const).filter((target) => repairTransition(repairStatus, target).allowed);
}

function toJobListItem(row: JobListRow): EngineerJobListItem {
  return {
    id: row.id,
    status: row.status,
    description: row.description,
    createdAt: row.createdAt,
    assignedAt: row.assignedAt,
    repairStatus: row.repairStatus,
    currentAttempt: row.repairAttempt,
    severity: effectiveSeverity(row.adminSeverity, row.aiSeverity),
    damageClasses: [...new Set(row.detections.map((d) => d.className))].sort(),
    needsMoreWork: needsMoreWorkFlag(row.repairStatus, row.repairAttempt, row.repairUpdates[0]),
    image: imageView(row.id, row.images[0]),
  };
}

function toJobView(row: JobDetailRow): EngineerJobView {
  const current = row.repairAttempt;
  const currentPhotos = current === null ? 0 : row.repairPhotos.filter((p) => p.attempt === current).length;
  const feedback = [...row.repairUpdates].reverse().find((u) => u.kind === "ADMIN_FEEDBACK" && u.attempt === current);
  return {
    id: row.id,
    status: row.status,
    description: row.description,
    createdAt: row.createdAt,
    assignedAt: row.assignedAt,
    location: { latitude: row.latitude, longitude: row.longitude, gpsAccuracyMeters: row.gpsAccuracyM },
    severity: { ai: row.aiSeverity, admin: row.adminSeverity, effective: effectiveSeverity(row.adminSeverity, row.aiSeverity) },
    analysis: { status: row.aiStatus, detections: detectionViews(row.detections) },
    image: imageView(row.id, row.images[0]),
    repair: {
      status: row.repairStatus,
      statusUpdatedAt: row.repairStatusUpdatedAt,
      currentAttempt: current,
      currentAttemptPhotoCount: currentPhotos,
      maxPhotosPerAttempt: MAX_REPAIR_PHOTOS_PER_ATTEMPT,
      canUploadPhotos:
        row.status === "ACCEPTED" && canUploadRepairPhoto(row.repairStatus) && currentPhotos < MAX_REPAIR_PHOTOS_PER_ATTEMPT,
      allowedTransitions: allowedTransitions(row.status, row.repairStatus),
      latestFeedback: feedback === undefined ? null : { note: feedback.note, createdAt: feedback.createdAt },
    },
    attempts: buildRepairAttempts(row.id, current, row.assignments, row.repairUpdates, row.repairPhotos),
  };
}

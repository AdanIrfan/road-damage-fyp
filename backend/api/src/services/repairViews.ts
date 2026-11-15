/**
 * Repair work grouped by attempt (Stage 4). Shared by the admin report view and the engineer job
 * view. Earlier attempts are kept forever as evidence; the current attempt is marked.
 */
import type { Prisma, RepairStatus, RepairUpdateKind, UserRole } from "../generated/prisma/client.js";

export interface PersonRef {
  id: string;
  fullName: string;
}

export interface RepairPhotoView {
  id: string;
  /** Authorised API URL of the metadata-free display copy. */
  url: string;
  width: number;
  height: number;
  attempt: number;
  uploadedBy: PersonRef;
  createdAt: Date;
}

export interface RepairUpdateView {
  id: string;
  kind: RepairUpdateKind;
  attempt: number;
  fromStatus: RepairStatus | null;
  toStatus: RepairStatus | null;
  note: string | null;
  author: PersonRef & { role: UserRole };
  createdAt: Date;
}

export interface RepairAttemptView {
  attempt: number;
  isCurrent: boolean;
  /** Engineer the attempt was assigned to (from the assignment that started it). */
  engineer: PersonRef | null;
  photos: RepairPhotoView[];
  updates: RepairUpdateView[];
}

const person = { select: { id: true, fullName: true } } as const;

export const assignmentHistorySelect = {
  orderBy: { createdAt: "asc" },
  select: {
    id: true,
    attempt: true,
    reason: true,
    createdAt: true,
    engineer: person,
    previousEngineer: person,
    assignedBy: person,
  },
} satisfies Prisma.Report$assignmentsArgs;

export const repairUpdatesSelect = {
  orderBy: { createdAt: "asc" },
  select: {
    id: true,
    kind: true,
    attempt: true,
    fromStatus: true,
    toStatus: true,
    note: true,
    createdAt: true,
    author: { select: { id: true, fullName: true, role: true } },
  },
} satisfies Prisma.Report$repairUpdatesArgs;

export const repairPhotosSelect = {
  orderBy: { createdAt: "asc" },
  select: { id: true, attempt: true, width: true, height: true, createdAt: true, uploadedBy: person },
} satisfies Prisma.Report$repairPhotosArgs;

type AssignmentRow = Prisma.ReportAssignmentGetPayload<{ select: typeof assignmentHistorySelect.select }>;
type UpdateRow = Prisma.RepairUpdateGetPayload<{ select: typeof repairUpdatesSelect.select }>;
type PhotoRow = Prisma.RepairPhotoGetPayload<{ select: typeof repairPhotosSelect.select }>;

export function repairPhotoPath(reportId: string, photoId: string): string {
  return `/api/v1/reports/${reportId}/repair-photos/${photoId}`;
}

export function repairPhotoView(reportId: string, row: PhotoRow): RepairPhotoView {
  return {
    id: row.id,
    url: repairPhotoPath(reportId, row.id),
    width: row.width,
    height: row.height,
    attempt: row.attempt,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt,
  };
}

/** Newest attempt first. Attempts without any rows still appear (e.g. a just-reopened attempt). */
export function buildRepairAttempts(
  reportId: string,
  currentAttempt: number | null,
  assignments: readonly AssignmentRow[],
  updates: readonly UpdateRow[],
  photos: readonly PhotoRow[],
): RepairAttemptView[] {
  if (currentAttempt === null) {
    return [];
  }
  const attempts: RepairAttemptView[] = [];
  for (let attempt = currentAttempt; attempt >= 1; attempt -= 1) {
    // The engineer of an attempt is the one from the latest assignment that started at or before it.
    const assignment = [...assignments].reverse().find((a) => a.attempt <= attempt);
    attempts.push({
      attempt,
      isCurrent: attempt === currentAttempt,
      engineer: assignment?.engineer ?? null,
      photos: photos.filter((p) => p.attempt === attempt).map((p) => repairPhotoView(reportId, p)),
      updates: updates.filter((u) => u.attempt === attempt),
    });
  }
  return attempts;
}

export function countCurrentAttemptPhotos(photos: readonly { attempt: number }[], currentAttempt: number | null): number {
  return currentAttempt === null ? 0 : photos.filter((p) => p.attempt === currentAttempt).length;
}

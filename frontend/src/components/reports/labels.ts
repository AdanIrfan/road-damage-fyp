import type {
  AiAnalysisStatus,
  CaptureMethod,
  LocationVerificationStatus,
  RepairProgress,
  RepairStatus,
  RepairUpdateKind,
  ReportStatus,
  SeverityLevel,
} from "../../lib/reportTypes";

type Tone = "green" | "red" | "amber" | "slate" | "blue";

export const reportStatusLabel: Record<ReportStatus, string> = {
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  DELAYED: "Delayed",
  COMPLETED: "Completed",
};

export const reportStatusTone: Record<ReportStatus, Tone> = {
  SUBMITTED: "blue",
  UNDER_REVIEW: "amber",
  ACCEPTED: "green",
  REJECTED: "red",
  DELAYED: "amber",
  COMPLETED: "green",
};

export const REPORT_STATUSES = Object.keys(reportStatusLabel) as ReportStatus[];

export const captureMethodLabel: Record<CaptureMethod, string> = {
  LIVE_CAMERA: "Live camera",
  GALLERY_UPLOAD: "Gallery upload",
};

/** Always shown with the word "estimated": this is a heuristic, not an engineering measurement. */
export const severityLabel: Record<SeverityLevel, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
};

export const severityTone: Record<SeverityLevel, Tone> = {
  LOW: "green",
  MEDIUM: "amber",
  HIGH: "red",
};

export const locationStatusLabel: Record<LocationVerificationStatus, string> = {
  VERIFIED: "Photo location matches",
  MISMATCH: "Photo location differs",
  NO_METADATA: "No location in photo",
  NOT_CHECKED: "Not checked",
  BROWSER_GPS: "Device GPS",
};

export const locationStatusHelp: Record<LocationVerificationStatus, string> = {
  VERIFIED: "The location stored in your photo is close to the place you selected.",
  MISMATCH: "The location stored in your photo is far from the place you selected. An administrator will check it.",
  NO_METADATA: "Your photo has no location data (many apps remove it). An administrator will check the location.",
  NOT_CHECKED: "The location has not been checked yet.",
  BROWSER_GPS: "The location was taken from your device's GPS when you took the photo.",
};

export const analysisStatusLabel: Record<AiAnalysisStatus, string> = {
  COMPLETED: "Analysed",
  FAILED: "Analysis unavailable",
};

/** "longitudinal_crack" → "Longitudinal crack". Class names come from the model. */
export function damageClassLabel(className: string): string {
  const words = className.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

export function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

export const repairStatusLabel: Record<RepairStatus, string> = {
  PENDING: "Pending",
  WORKING: "Working",
  COMPLETED: "Completed",
};

export const repairStatusTone: Record<RepairStatus, Tone> = {
  PENDING: "slate",
  WORKING: "blue",
  COMPLETED: "green",
};

export const repairProgressLabel: Record<RepairProgress, string> = {
  NOT_ASSIGNED: "Repair not scheduled yet",
  SCHEDULED: "Repair scheduled",
  IN_PROGRESS: "Repair in progress",
  AWAITING_CONFIRMATION: "Repair done, awaiting final check",
  DONE: "Repaired",
};

export const repairUpdateKindLabel: Record<RepairUpdateKind, string> = {
  STATUS_CHANGE: "Status change",
  NOTE: "Note",
  ADMIN_FEEDBACK: "Needs more work",
};

/** "Repair" status for admins: shows the current attempt as well. */
export function repairStatusWithAttempt(status: RepairStatus | null, attempt: number | null): string {
  if (status === null) return "Not assigned";
  return attempt !== null && attempt > 1 ? `${repairStatusLabel[status]} (attempt ${attempt})` : repairStatusLabel[status];
}

/** Short title for a report in lists: what was detected, or why nothing is shown. */
export function reportTitle(damageClasses: string[], analysisStatus: AiAnalysisStatus): string {
  if (damageClasses.length > 0) return damageClasses.map(damageClassLabel).join(", ");
  return analysisStatus === "FAILED" ? "Analysis unavailable" : "No damage detected";
}

/** "3 d", "5 h", "12 min": how long ago something happened, for "waiting" columns. */
export function formatAge(iso: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

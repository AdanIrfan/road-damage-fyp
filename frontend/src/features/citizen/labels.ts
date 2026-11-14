import type { AiAnalysisStatus, CaptureMethod, LocationVerificationStatus, ReportStatus, SeverityLevel } from "./types";

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

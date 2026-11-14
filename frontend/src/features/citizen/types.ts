/** Mirrors the backend's report view models (backend/api/src/services/report.service.ts). */

export type ReportStatus = "SUBMITTED" | "UNDER_REVIEW" | "ACCEPTED" | "REJECTED" | "DELAYED" | "COMPLETED";
export type CaptureMethod = "LIVE_CAMERA" | "GALLERY_UPLOAD";
export type LocationVerificationStatus = "VERIFIED" | "MISMATCH" | "NO_METADATA" | "NOT_CHECKED" | "BROWSER_GPS";
export type AiAnalysisStatus = "COMPLETED" | "FAILED";
export type SeverityLevel = "LOW" | "MEDIUM" | "HIGH";

export interface ReportImage {
  id: string;
  url: string;
  width: number;
  height: number;
}

export interface Detection {
  id: string;
  className: string;
  confidence: number;
  box: { x1: number; y1: number; x2: number; y2: number };
  areaFraction: number;
}

export interface Report {
  id: string;
  status: ReportStatus;
  captureMethod: CaptureMethod;
  description: string | null;
  createdAt: string;
  updatedAt: string;
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
    analyzedAt: string | null;
    model: string | null;
    estimatedSeverity: SeverityLevel | null;
    severityScore: number | null;
    detections: Detection[];
  };
  image: ReportImage | null;
}

export interface ReportListItem {
  id: string;
  status: ReportStatus;
  captureMethod: CaptureMethod;
  description: string | null;
  createdAt: string;
  location: { latitude: number; longitude: number; verificationStatus: LocationVerificationStatus; needsReview: boolean };
  analysis: { status: AiAnalysisStatus; estimatedSeverity: SeverityLevel | null; detectionCount: number; damageClasses: string[] };
  image: ReportImage | null;
}

export interface ReportSummary {
  total: number;
  byStatus: Record<ReportStatus, number>;
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/** What the "new report" flow hands to the submit call. */
export interface ReportDraft {
  captureMethod: CaptureMethod;
  photo: Blob;
  location: Coordinates;
  /** Live camera only. */
  gpsAccuracyMeters?: number;
  description: string;
}

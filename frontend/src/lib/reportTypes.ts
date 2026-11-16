/** Report types shared by citizen, admin and engineer pages (mirror backend/api/src/services/reportViews.ts). */

export type ReportStatus = "SUBMITTED" | "UNDER_REVIEW" | "ACCEPTED" | "REJECTED" | "DELAYED" | "COMPLETED";
export type CaptureMethod = "LIVE_CAMERA" | "GALLERY_UPLOAD";
export type LocationVerificationStatus = "VERIFIED" | "MISMATCH" | "NO_METADATA" | "NOT_CHECKED" | "BROWSER_GPS";
export type AiAnalysisStatus = "COMPLETED" | "FAILED";
export type SeverityLevel = "LOW" | "MEDIUM" | "HIGH";
export type RepairStatus = "PENDING" | "WORKING" | "COMPLETED";
export type RepairUpdateKind = "STATUS_CHANGE" | "NOTE" | "ADMIN_FEEDBACK";
/** Citizen view of repair progress (no engineer identity). */
export type RepairProgress = "NOT_ASSIGNED" | "SCHEDULED" | "IN_PROGRESS" | "AWAITING_CONFIRMATION" | "DONE";

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
  /** Latest reason while REJECTED or DELAYED. */
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
  repairProgress: RepairProgress | null;
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

// ---------------------------------------------------------------------------
// Stage 4: admin and engineer views (mirror backend adminReport/engineerJob services)
// ---------------------------------------------------------------------------

export interface PersonRef {
  id: string;
  fullName: string;
}

export interface RepairPhoto {
  id: string;
  url: string;
  width: number;
  height: number;
  attempt: number;
  uploadedBy: PersonRef;
  createdAt: string;
}

export interface RepairUpdate {
  id: string;
  kind: RepairUpdateKind;
  attempt: number;
  fromStatus: RepairStatus | null;
  toStatus: RepairStatus | null;
  note: string | null;
  author: PersonRef & { role: "CITIZEN" | "ADMIN" | "ENGINEER" };
  createdAt: string;
}

export interface RepairAttempt {
  attempt: number;
  isCurrent: boolean;
  engineer: PersonRef | null;
  photos: RepairPhoto[];
  updates: RepairUpdate[];
}

export interface SeverityInfo {
  ai: SeverityLevel | null;
  admin: SeverityLevel | null;
  effective: SeverityLevel | null;
}

export interface AdminReport {
  id: string;
  status: ReportStatus;
  captureMethod: CaptureMethod;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  citizen: { id: string; fullName: string; mobileNumber: string; status: string };
  location: {
    latitude: number;
    longitude: number;
    gpsAccuracyMeters: number | null;
    verificationStatus: LocationVerificationStatus;
    needsReview: boolean;
    exif: { latitude: number; longitude: number; distanceMeters: number | null } | null;
  };
  analysis: {
    status: AiAnalysisStatus;
    errorCode: string | null;
    analyzedAt: string | null;
    model: string | null;
    detections: Detection[];
    severityScore: number | null;
  };
  severity: SeverityInfo & { adminSetBy: PersonRef | null; adminSetAt: string | null };
  image: ReportImage | null;
  assignment: {
    status: "ASSIGNED" | "UNASSIGNED";
    engineer: (PersonRef & { mobileNumber: string; status: string; mustChangePassword: boolean }) | null;
    assignedAt: string | null;
    repairStatus: RepairStatus | null;
    repairStatusUpdatedAt: string | null;
    currentAttempt: number | null;
  };
  statusHistory: {
    id: string;
    fromStatus: ReportStatus | null;
    toStatus: ReportStatus;
    note: string | null;
    changedBy: (PersonRef & { role: string }) | null;
    createdAt: string;
  }[];
  assignmentHistory: {
    id: string;
    attempt: number;
    reason: string | null;
    engineer: PersonRef;
    previousEngineer: PersonRef | null;
    assignedBy: PersonRef;
    createdAt: string;
  }[];
  repairAttempts: RepairAttempt[];
  allowedActions: { review: boolean; decide: boolean; assign: boolean; feedback: boolean; confirmCompletion: boolean; retryAnalysis: boolean };
}

export interface AdminReportListItem {
  id: string;
  status: ReportStatus;
  captureMethod: CaptureMethod;
  createdAt: string;
  description: string | null;
  citizen: PersonRef;
  severity: SeverityInfo;
  analysis: { status: AiAnalysisStatus; detectionCount: number; damageClasses: string[] };
  location: { verificationStatus: LocationVerificationStatus; needsReview: boolean; latitude: number; longitude: number };
  assignment: { engineer: PersonRef | null; repairStatus: RepairStatus | null; currentAttempt: number | null };
  image: ReportImage | null;
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
    locationFlagged: number;
    aiFailed: number;
    jobsOnDeactivatedEngineers: number;
  };
  activeEngineers: number;
  recent: AdminReportListItem[];
}

/** An admin action's result; `notification` is present when a citizen SMS was due. */
export interface AdminActionResult {
  report: AdminReport;
  notification?: "sent" | "failed";
}

export interface EngineerSuggestion {
  id: string;
  fullName: string;
  mobileNumber: string;
  openJobs: number;
  mustChangePassword: boolean;
  isCurrent: boolean;
}

export interface EngineerJob {
  id: string;
  status: ReportStatus;
  description: string | null;
  createdAt: string;
  assignedAt: string | null;
  location: { latitude: number; longitude: number; gpsAccuracyMeters: number | null };
  severity: SeverityInfo;
  analysis: { status: AiAnalysisStatus; detections: Detection[] };
  image: ReportImage | null;
  repair: {
    status: RepairStatus | null;
    statusUpdatedAt: string | null;
    currentAttempt: number | null;
    currentAttemptPhotoCount: number;
    maxPhotosPerAttempt: number;
    canUploadPhotos: boolean;
    allowedTransitions: ("WORKING" | "COMPLETED")[];
    latestFeedback: { note: string | null; createdAt: string } | null;
  };
  attempts: RepairAttempt[];
}

export interface EngineerJobListItem {
  id: string;
  status: ReportStatus;
  description: string | null;
  createdAt: string;
  assignedAt: string | null;
  repairStatus: RepairStatus | null;
  currentAttempt: number | null;
  severity: SeverityLevel | null;
  damageClasses: string[];
  needsMoreWork: boolean;
  location: { latitude: number; longitude: number };
  image: ReportImage | null;
}

export interface EngineerSummary {
  active: number;
  awaitingConfirmation: number;
  completed: number;
  needsMoreWork: number;
}

// ---------------------------------------------------------------------------
// Phase 5: admin analytics (mirrors backend src/services/analytics.service.ts)
// ---------------------------------------------------------------------------

export type AnalyticsGranularity = "day" | "week" | "month";

export interface AdminAnalytics {
  range: { from: string | null; to: string | null; granularity: AnalyticsGranularity };
  total: number;
  overTime: { period: string; count: number }[];
  byStatus: Record<ReportStatus, number>;
  bySeverity: Record<SeverityLevel | "NONE", number>;
  damageClasses: { byClass: { className: string; reports: number }[]; noDetections: number; aiFailed: number };
  repairProgress: { unassigned: number; pending: number; working: number; awaitingConfirmation: number; completed: number };
  engineerWorkload: {
    engineerId: string;
    fullName: string;
    status: "PENDING_VERIFICATION" | "ACTIVE" | "DEACTIVATED";
    open: number;
    awaitingConfirmation: number;
    completed: number;
  }[];
  location: {
    byStatus: { status: LocationVerificationStatus; reports: number; needsReview: number }[];
    needsReview: number;
  };
  /** Hours from submission, from the status history; each report counts once per measure. */
  turnaround: { toReview: TurnaroundStat; toDecision: TurnaroundStat; toCompletion: TurnaroundStat };
}

export interface TurnaroundStat {
  reports: number;
  medianHours: number | null;
  averageHours: number | null;
}

/** Other reports near this one in place and time. A hint for admins; nothing is merged or rejected. */
export interface PossibleDuplicates {
  criteria: { radiusMeters: number; windowDays: number };
  matches: (AdminReportListItem & { distanceMeters: number })[];
}

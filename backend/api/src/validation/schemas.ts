import { z } from "zod";
import { OTP_LENGTH, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../config/auth.js";
import { DESCRIPTION_MAX_LENGTH, REPORT_LIST_MAX_PAGE_SIZE } from "../config/reports.js";
import {
  ADMIN_NOTE_MAX_LENGTH,
  ADMIN_REPORT_LIST_MAX_PAGE_SIZE,
  DECISION_REASON_MAX_LENGTH,
  FEEDBACK_MAX_LENGTH,
  REPAIR_NOTE_MAX_LENGTH,
} from "../config/workflow.js";

// Mobile numbers are only shape-checked here; services normalize them to E.164
// (they need the configured default country).

const fullName = z
  .string({ error: "Full name is required." })
  .trim()
  .min(2, "Full name must be at least 2 characters.")
  .max(100, "Full name must be at most 100 characters.");

const mobileNumber = z
  .string({ error: "Mobile number is required." })
  .trim()
  .min(1, "Mobile number is required.")
  .max(32, "Mobile number is too long.");

const newPassword = z
  .string({ error: "Password is required." })
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`);

/** The rule for every new password (registration, password change, CLI reset). */
export const newPasswordSchema = newPassword;

const existingPassword = z
  .string({ error: "Password is required." })
  .min(1, "Password is required.")
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`);

export const registerSchema = z
  .strictObject({
    fullName,
    mobileNumber,
    password: newPassword,
    confirmPassword: z.string({ error: "Confirm your password." }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export const verifyOtpSchema = z.strictObject({
  mobileNumber,
  code: z
    .string({ error: "Code is required." })
    .trim()
    .regex(new RegExp(`^\\d{${OTP_LENGTH}}$`), `Enter the ${OTP_LENGTH}-digit code.`),
});

export const resendOtpSchema = z.strictObject({ mobileNumber });

export const loginSchema = z.strictObject({ mobileNumber, password: existingPassword });

export const updateProfileSchema = z.strictObject({ fullName });

export const changePasswordSchema = z
  .strictObject({
    currentPassword: existingPassword,
    newPassword,
    confirmNewPassword: z.string({ error: "Confirm your new password." }),
  })
  .refine((data) => data.newPassword === data.confirmNewPassword, {
    message: "Passwords do not match.",
    path: ["confirmNewPassword"],
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    message: "New password must be different from the current password.",
    path: ["newPassword"],
  });

export const createEngineerSchema = z.strictObject({
  fullName,
  mobileNumber,
  temporaryPassword: newPassword,
});

export const updateEngineerSchema = z
  .strictObject({ fullName: fullName.optional(), mobileNumber: mobileNumber.optional() })
  .refine((data) => data.fullName !== undefined || data.mobileNumber !== undefined, {
    message: "Provide at least one field to update.",
  });

export const engineerStatusSchema = z.strictObject({
  status: z.enum(["ACTIVE", "DEACTIVATED"], { error: "Status must be ACTIVE or DEACTIVATED." }),
});

export const engineerIdParamsSchema = z.strictObject({
  id: z.uuid({ error: "Invalid engineer id." }),
});

export const listEngineersQuerySchema = z.strictObject({
  status: z.enum(["ACTIVE", "DEACTIVATED"], { error: "Status must be ACTIVE or DEACTIVATED." }).optional(),
  search: z.string().trim().max(100, "Search is too long.").optional(),
  page: z.coerce.number().int().min(1, "Page must be 1 or more.").default(1),
  pageSize: z.coerce.number().int().min(1).max(100, "Page size must be at most 100.").default(20),
});

// ---------------------------------------------------------------------------
// Reports (Phase 3). Multipart form fields always arrive as strings.
// ---------------------------------------------------------------------------

/** A decimal number sent as a multipart text field, within [min, max]. Empty strings are rejected. */
const decimalField = (label: string, min: number, max: number) =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .regex(/^-?\d+(\.\d+)?$/, `${label} must be a number.`)
    .transform(Number)
    .pipe(z.number().min(min, `${label} must be between ${min} and ${max}.`).max(max, `${label} must be between ${min} and ${max}.`));

export const createReportSchema = z
  .strictObject({
    captureMethod: z.enum(["LIVE_CAMERA", "GALLERY_UPLOAD"], { error: "Choose live camera or gallery upload." }),
    latitude: decimalField("Latitude", -90, 90),
    longitude: decimalField("Longitude", -180, 180),
    /** Browser-reported GPS accuracy in metres. Required for live camera, not allowed for gallery uploads. */
    gpsAccuracyMeters: decimalField("GPS accuracy", 0, 1_000_000).optional(),
    description: z
      .string()
      .trim()
      .max(DESCRIPTION_MAX_LENGTH, `Description must be at most ${DESCRIPTION_MAX_LENGTH} characters.`)
      .optional()
      .transform((value) => (value === "" ? undefined : value)),
  })
  .superRefine((data, ctx) => {
    if (data.captureMethod === "LIVE_CAMERA" && data.gpsAccuracyMeters === undefined) {
      ctx.addIssue({ code: "custom", path: ["gpsAccuracyMeters"], message: "GPS accuracy is required for live camera reports." });
    }
    if (data.captureMethod === "GALLERY_UPLOAD" && data.gpsAccuracyMeters !== undefined) {
      ctx.addIssue({ code: "custom", path: ["gpsAccuracyMeters"], message: "GPS accuracy is only sent for live camera reports." });
    }
  });

export const REPORT_STATUSES = ["SUBMITTED", "UNDER_REVIEW", "ACCEPTED", "REJECTED", "DELAYED", "COMPLETED"] as const;

export const listReportsQuerySchema = z.strictObject({
  status: z.enum(REPORT_STATUSES, { error: "Unknown report status." }).optional(),
  sort: z.enum(["newest", "oldest"], { error: "Sort must be newest or oldest." }).default("newest"),
  page: z.coerce.number().int().min(1, "Page must be 1 or more.").default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(REPORT_LIST_MAX_PAGE_SIZE, `Page size must be at most ${REPORT_LIST_MAX_PAGE_SIZE}.`)
    .default(10),
});

export const reportIdParamsSchema = z.strictObject({
  id: z.uuid({ error: "Invalid report id." }),
});

export const reportImageParamsSchema = z.strictObject({
  id: z.uuid({ error: "Invalid report id." }),
  imageId: z.uuid({ error: "Invalid image id." }),
});

// ---------------------------------------------------------------------------
// Stage 4: admin report workflow and engineer jobs
// ---------------------------------------------------------------------------

const SEVERITY_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
const REPAIR_STATUSES = ["PENDING", "WORKING", "COMPLETED"] as const;

/** Trimmed text; an empty string counts as "not given". */
const optionalText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters.`)
    .optional()
    .transform((value) => (value === "" ? undefined : value));

const requiredText = (label: string, max: number) =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be at most ${max} characters.`);

const attemptNumber = z.coerce
  .number({ error: "The repair attempt is required." })
  .int("The repair attempt must be a whole number.")
  .min(1, "The repair attempt must be 1 or more.");

export const decisionSchema = z
  .strictObject({
    decision: z.enum(["ACCEPT", "REJECT", "DELAY"], { error: "Decision must be ACCEPT, REJECT or DELAY." }),
    reason: optionalText("Reason", DECISION_REASON_MAX_LENGTH),
  })
  .superRefine((data, ctx) => {
    if (data.decision !== "ACCEPT" && data.reason === undefined) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: "A reason is required to reject or delay a report." });
    }
  });

export const severitySchema = z.strictObject({
  severity: z.enum(SEVERITY_LEVELS, { error: "Severity must be LOW, MEDIUM or HIGH." }),
});

export const feedbackSchema = z.strictObject({
  note: requiredText("Feedback", FEEDBACK_MAX_LENGTH),
  expectedAttempt: attemptNumber,
});

export const confirmCompletionSchema = z.strictObject({
  expectedAttempt: attemptNumber,
  note: optionalText("Note", ADMIN_NOTE_MAX_LENGTH),
});

export const assignEngineerSchema = z.strictObject({
  engineerId: z.uuid({ error: "Choose an engineer." }),
  reason: optionalText("Reason", ADMIN_NOTE_MAX_LENGTH),
});

const isoDate = z.iso.date({ error: "Use a date in the form YYYY-MM-DD." });

export const listAdminReportsQuerySchema = z
  .strictObject({
    page: z.coerce.number().int().min(1, "Page must be 1 or more.").default(1),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(ADMIN_REPORT_LIST_MAX_PAGE_SIZE, `Page size must be at most ${ADMIN_REPORT_LIST_MAX_PAGE_SIZE}.`)
      .default(20),
    sort: z.enum(["newest", "oldest"], { error: "Sort must be newest or oldest." }).default("newest"),
    search: optionalText("Search", 100),
    status: z.enum(REPORT_STATUSES, { error: "Unknown report status." }).optional(),
    severity: z.enum(SEVERITY_LEVELS, { error: "Unknown severity." }).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    captureMethod: z.enum(["LIVE_CAMERA", "GALLERY_UPLOAD"], { error: "Unknown capture method." }).optional(),
    locationStatus: z
      .enum(["VERIFIED", "MISMATCH", "NO_METADATA", "NOT_CHECKED", "BROWSER_GPS"], { error: "Unknown location status." })
      .optional(),
    needsLocationReview: z
      .enum(["true", "false"], { error: "Use true or false." })
      .transform((value) => value === "true")
      .optional(),
    aiStatus: z.enum(["COMPLETED", "FAILED"], { error: "Unknown analysis status." }).optional(),
    damageClass: z
      .string()
      .trim()
      .regex(/^[a-z0-9_]{1,100}$/i, "Unknown damage class.")
      .optional(),
    assignment: z.enum(["assigned", "unassigned"], { error: "Assignment must be assigned or unassigned." }).optional(),
    engineerId: z.uuid({ error: "Invalid engineer id." }).optional(),
    repairStatus: z.enum(REPAIR_STATUSES, { error: "Unknown repair status." }).optional(),
  })
  .refine((q) => q.from === undefined || q.to === undefined || q.from <= q.to, {
    message: "The start date must not be after the end date.",
    path: ["to"],
  });

export const engineerJobsQuerySchema = z.strictObject({
  scope: z.enum(["active", "history"], { error: "Scope must be active or history." }).default("active"),
  page: z.coerce.number().int().min(1, "Page must be 1 or more.").default(1),
  pageSize: z.coerce.number().int().min(1).max(50, "Page size must be at most 50.").default(20),
});

export const jobIdParamsSchema = z.strictObject({
  reportId: z.uuid({ error: "Invalid job id." }),
});

export const repairStatusSchema = z.strictObject({
  // PENDING is only the initial state of an attempt; it can never be requested.
  status: z.enum(["WORKING", "COMPLETED"], { error: "Status must be WORKING or COMPLETED." }),
  expectedAttempt: attemptNumber,
  note: optionalText("Note", REPAIR_NOTE_MAX_LENGTH),
});

export const repairNoteSchema = z.strictObject({
  note: requiredText("Note", REPAIR_NOTE_MAX_LENGTH),
  expectedAttempt: attemptNumber,
});

/** Multipart text fields that accompany a repair photo. */
export const repairPhotoFieldsSchema = z.strictObject({
  expectedAttempt: attemptNumber,
});

export const repairPhotoParamsSchema = z.strictObject({
  id: z.uuid({ error: "Invalid report id." }),
  photoId: z.uuid({ error: "Invalid photo id." }),
});

import { z } from "zod";
import { OTP_LENGTH, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../config/auth.js";
import { DESCRIPTION_MAX_LENGTH, REPORT_LIST_MAX_PAGE_SIZE } from "../config/reports.js";

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

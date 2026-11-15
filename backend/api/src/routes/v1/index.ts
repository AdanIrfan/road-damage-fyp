import cookieParser from "cookie-parser";
import { Router } from "express";
import { createAdminReportsController } from "../../controllers/adminReports.controller.js";
import { createAuthController } from "../../controllers/auth.controller.js";
import { createEngineerJobsController } from "../../controllers/engineerJobs.controller.js";
import { createEngineersController } from "../../controllers/engineers.controller.js";
import { createProfileController } from "../../controllers/profile.controller.js";
import { createReportsController } from "../../controllers/reports.controller.js";
import { createAuthenticate, requirePasswordChanged, requireRole } from "../../middleware/auth.js";
import { createCsrf } from "../../middleware/csrf.js";
import { createAuthRateLimiters, createRepairPhotoRateLimiter, createReportRateLimiter } from "../../middleware/rateLimit.js";
import { uploadReportImage } from "../../middleware/upload.js";
import type { Services } from "../../services/index.js";
import type { CookieSettings } from "../../utils/authCookies.js";

export interface V1Dependencies {
  services: Services;
  cookies: CookieSettings;
  /** Per-IP limits on login/register/OTP, per-user limits on report submissions and repair photo uploads. Disabled in tests. */
  rateLimiting: boolean;
}

/**
 * Version 1 of the application API, mounted at /api/v1.
 *
 * Auth (public, CSRF-protected):  /auth/csrf, /auth/register, /auth/otp/verify, /auth/otp/resend,
 *                                 /auth/login, /auth/refresh, /auth/logout
 * Logged in (any role):           /auth/me, /profile, /profile/password
 * Citizens:                       /reports (submit, list, summary, detail), /reports/:id/images/:imageId
 * Engineers:                      /engineer/summary, /engineer/jobs... (own jobs only), report images + repair photos of own jobs
 * Admin only:                     /admin/engineers..., /admin/dashboard, /admin/reports... (+ any report image)
 *
 * Without dependencies (some tests) no application routes are mounted.
 */
export function createV1Router(deps?: V1Dependencies): Router {
  const router = Router();
  if (deps === undefined) {
    return router;
  }

  const { services, cookies } = deps;
  const csrf = createCsrf(services.csrfKey, cookies);
  const authenticate = createAuthenticate({ tokens: services.tokens, users: services.users });
  const limits = createAuthRateLimiters(deps.rateLimiting);

  const auth = createAuthController({ auth: services.auth, csrf, cookies });
  const profile = createProfileController({ auth: services.auth, users: services.users, cookies });
  const engineers = createEngineersController({ engineers: services.engineers, auth: services.auth });
  const reports = createReportsController({ reports: services.reports });
  const adminReports = createAdminReportsController({ reports: services.adminReports, assignments: services.assignments });
  const reportLimit = createReportRateLimiter(deps.rateLimiting);
  const engineerJobs = createEngineerJobsController({ jobs: services.engineerJobs });
  const repairPhotoLimit = createRepairPhotoRateLimiter(deps.rateLimiting);

  router.use(cookieParser());
  // Every state-changing /api/v1 request needs a valid CSRF token (including login).
  router.use(csrf.protect);

  const authRouter = Router();
  authRouter.get("/csrf", auth.csrfToken);
  authRouter.post("/register", limits.register, auth.register);
  authRouter.post("/otp/verify", limits.otp, auth.verifyOtp);
  authRouter.post("/otp/resend", limits.otp, auth.resendOtp);
  authRouter.post("/login", limits.login, auth.login);
  authRouter.post("/refresh", auth.refresh);
  authRouter.post("/logout", auth.logout);
  authRouter.get("/me", authenticate, auth.me);
  router.use("/auth", authRouter);

  // Viewing the profile and changing the password stay available while a temporary
  // password is in force; everything else requires it to be changed first.
  const profileRouter = Router();
  profileRouter.use(authenticate);
  profileRouter.get("/", profile.get);
  profileRouter.patch("/", requirePasswordChanged, profile.update);
  profileRouter.post("/password", profile.changePassword);
  router.use("/profile", profileRouter);

  const adminRouter = Router();
  adminRouter.use(authenticate, requireRole("ADMIN"), requirePasswordChanged);
  adminRouter.get("/engineers", engineers.list);
  adminRouter.post("/engineers", engineers.create);
  adminRouter.get("/engineers/:id", engineers.get);
  adminRouter.patch("/engineers/:id", engineers.update);
  adminRouter.patch("/engineers/:id/status", engineers.setStatus);
  adminRouter.get("/dashboard", adminReports.dashboard);
  adminRouter.get("/reports", adminReports.list);
  adminRouter.get("/reports/:id", adminReports.get);
  adminRouter.post("/reports/:id/review", adminReports.review);
  adminRouter.post("/reports/:id/decision", adminReports.decide);
  adminRouter.patch("/reports/:id/severity", adminReports.setSeverity);
  adminRouter.post("/reports/:id/feedback", adminReports.feedback);
  adminRouter.post("/reports/:id/confirm-completion", adminReports.confirmCompletion);
  adminRouter.get("/reports/:id/engineer-suggestions", adminReports.suggestions);
  adminRouter.post("/reports/:id/assignment", adminReports.assign);
  router.use("/admin", adminRouter);

  // Order matters for uploads: authentication, role, CSRF (above) and the rate limit run BEFORE
  // the multipart body is parsed.
  const reportsRouter = Router();
  reportsRouter.use(authenticate, requirePasswordChanged);
  reportsRouter.post("/", requireRole("CITIZEN"), reportLimit, uploadReportImage, reports.create);
  reportsRouter.get("/", requireRole("CITIZEN"), reports.list);
  reportsRouter.get("/summary", requireRole("CITIZEN"), reports.summary);
  reportsRouter.get("/:id", requireRole("CITIZEN"), reports.get);
  reportsRouter.get("/:id/images/:imageId", requireRole("CITIZEN", "ADMIN", "ENGINEER"), reports.image);
  reportsRouter.get("/:id/repair-photos/:photoId", requireRole("ADMIN", "ENGINEER"), engineerJobs.repairPhoto);
  router.use("/reports", reportsRouter);

  // Engineers: only their own jobs (enforced in the service). Uploads are parsed after auth/CSRF/limit.
  const engineerRouter = Router();
  engineerRouter.use(authenticate, requireRole("ENGINEER"), requirePasswordChanged);
  engineerRouter.get("/summary", engineerJobs.summary);
  engineerRouter.get("/jobs", engineerJobs.list);
  engineerRouter.get("/jobs/:reportId", engineerJobs.get);
  engineerRouter.patch("/jobs/:reportId/repair-status", engineerJobs.setRepairStatus);
  engineerRouter.post("/jobs/:reportId/notes", engineerJobs.addNote);
  engineerRouter.post("/jobs/:reportId/photos", repairPhotoLimit, uploadReportImage, engineerJobs.addPhoto);
  router.use("/engineer", engineerRouter);

  return router;
}

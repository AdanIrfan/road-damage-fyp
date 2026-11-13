import cookieParser from "cookie-parser";
import { Router } from "express";
import { createAuthController } from "../../controllers/auth.controller.js";
import { createEngineersController } from "../../controllers/engineers.controller.js";
import { createProfileController } from "../../controllers/profile.controller.js";
import { createAuthenticate, requirePasswordChanged, requireRole } from "../../middleware/auth.js";
import { createCsrf } from "../../middleware/csrf.js";
import { createAuthRateLimiters } from "../../middleware/rateLimit.js";
import type { Services } from "../../services/index.js";
import type { CookieSettings } from "../../utils/authCookies.js";

export interface V1Dependencies {
  services: Services;
  cookies: CookieSettings;
  /** Per-IP rate limits on login/register/OTP. Disabled in tests. */
  rateLimiting: boolean;
}

/**
 * Version 1 of the application API, mounted at /api/v1.
 *
 * Auth (public, CSRF-protected):  /auth/csrf, /auth/register, /auth/otp/verify, /auth/otp/resend,
 *                                 /auth/login, /auth/refresh, /auth/logout
 * Logged in (any role):           /auth/me, /profile, /profile/password
 * Admin only:                     /admin/engineers...
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
  router.use("/admin", adminRouter);

  return router;
}

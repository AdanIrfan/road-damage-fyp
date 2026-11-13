import type { RequestHandler } from "express";
import { REFRESH_TOKEN_COOKIE } from "../config/auth.js";
import type { Csrf } from "../middleware/csrf.js";
import { getAuthUser } from "../middleware/auth.js";
import type { AuthService } from "../services/auth.service.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { clearSessionCookies, readCookie, setSessionCookies, type CookieSettings } from "../utils/authCookies.js";
import { HttpError } from "../utils/httpError.js";
import { parseInput } from "../utils/validation.js";
import { loginSchema, registerSchema, resendOtpSchema, verifyOtpSchema } from "../validation/schemas.js";

export interface AuthController {
  csrfToken: RequestHandler;
  register: RequestHandler;
  verifyOtp: RequestHandler;
  resendOtp: RequestHandler;
  login: RequestHandler;
  refresh: RequestHandler;
  logout: RequestHandler;
  me: RequestHandler;
}

export function createAuthController(deps: { auth: AuthService; csrf: Csrf; cookies: CookieSettings }): AuthController {
  const { auth, csrf, cookies } = deps;

  return {
    csrfToken: (req, res) => {
      sendSuccess(res, { csrfToken: csrf.issueToken(req, res) });
    },

    register: async (req, res) => {
      const input = parseInput(registerSchema, req.body);
      const result = await auth.registerCitizen(input);
      sendSuccess(
        res,
        {
          mobileNumber: result.mobileNumber,
          otpExpiresAt: result.expiresAt.toISOString(),
          resendAvailableAt: result.resendAvailableAt.toISOString(),
        },
        201,
      );
    },

    verifyOtp: async (req, res) => {
      const input = parseInput(verifyOtpSchema, req.body);
      await auth.verifyMobile(input);
      sendSuccess(res, { verified: true });
    },

    resendOtp: async (req, res) => {
      const input = parseInput(resendOtpSchema, req.body);
      const result = await auth.resendVerificationCode(input);
      sendSuccess(res, {
        message: "If an account is awaiting verification, a new code has been sent.",
        ...(result === undefined
          ? {}
          : { otpExpiresAt: result.expiresAt.toISOString(), resendAvailableAt: result.resendAvailableAt.toISOString() }),
      });
    },

    login: async (req, res) => {
      const input = parseInput(loginSchema, req.body);
      const { user, session } = await auth.login(input);
      setSessionCookies(res, session, cookies);
      sendSuccess(res, { user });
    },

    refresh: async (req, res) => {
      const refreshToken = readCookie(req, REFRESH_TOKEN_COOKIE);
      if (refreshToken === undefined) {
        clearSessionCookies(res, cookies);
        throw new HttpError(401, "SESSION_INVALID", "Your session has ended. Please log in again.");
      }
      try {
        const { user, session } = await auth.refresh(refreshToken);
        setSessionCookies(res, session, cookies);
        sendSuccess(res, { user });
      } catch (error) {
        clearSessionCookies(res, cookies);
        throw error;
      }
    },

    logout: async (req, res) => {
      await auth.logout(readCookie(req, REFRESH_TOKEN_COOKIE));
      clearSessionCookies(res, cookies);
      sendSuccess(res, { loggedOut: true });
    },

    me: (req, res) => {
      sendSuccess(res, { user: getAuthUser(req) });
    },
  };
}

import type { CookieOptions, Request, Response } from "express";
import {
  ACCESS_TOKEN_COOKIE,
  ACCESS_TOKEN_COOKIE_PATH,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE_PATH,
} from "../config/auth.js";
import type { CookieSameSite } from "../config/env.js";
import type { IssuedSession } from "../services/token.service.js";

export interface CookieSettings {
  /** True in production: cookies are only sent over HTTPS. */
  secure: boolean;
  sameSite: CookieSameSite;
}

/** All auth cookies are httpOnly: JavaScript (including injected scripts) cannot read them. */
export function baseCookieOptions(settings: CookieSettings, path: string): CookieOptions {
  return { httpOnly: true, secure: settings.secure, sameSite: settings.sameSite, path };
}

export function setSessionCookies(res: Response, session: IssuedSession, settings: CookieSettings): void {
  res.cookie(ACCESS_TOKEN_COOKIE, session.accessToken, {
    ...baseCookieOptions(settings, ACCESS_TOKEN_COOKIE_PATH),
    maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
  });
  res.cookie(REFRESH_TOKEN_COOKIE, session.refreshToken, {
    ...baseCookieOptions(settings, REFRESH_TOKEN_COOKIE_PATH),
    expires: session.refreshTokenExpiresAt,
  });
}

export function clearSessionCookies(res: Response, settings: CookieSettings): void {
  res.clearCookie(ACCESS_TOKEN_COOKIE, baseCookieOptions(settings, ACCESS_TOKEN_COOKIE_PATH));
  res.clearCookie(REFRESH_TOKEN_COOKIE, baseCookieOptions(settings, REFRESH_TOKEN_COOKIE_PATH));
}

export function readCookie(req: Request, name: string): string | undefined {
  const cookies: unknown = req.cookies;
  if (typeof cookies !== "object" || cookies === null) {
    return undefined;
  }
  const value: unknown = (cookies as Record<string, unknown>)[name];
  return typeof value === "string" && value !== "" ? value : undefined;
}

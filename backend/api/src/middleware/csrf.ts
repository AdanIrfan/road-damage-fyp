import type { Request, RequestHandler, Response } from "express";
import { CSRF_COOKIE, CSRF_HEADER } from "../config/auth.js";
import { baseCookieOptions, readCookie, type CookieSettings } from "../utils/authCookies.js";
import { hmacHex, randomToken, safeEqual } from "../utils/crypto.js";
import { HttpError } from "../utils/httpError.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF protection for cookie-authenticated requests ("signed double-submit cookie").
 *
 * 1. The client calls GET /api/v1/auth/csrf. The server sets an httpOnly `csrf_token`
 *    cookie and returns the same token in the JSON body; the frontend keeps it in memory.
 * 2. Every POST/PUT/PATCH/DELETE must send the token in the `X-CSRF-Token` header.
 *    The header must equal the cookie, and the token must carry a valid server signature.
 *
 * A malicious site can make the browser send cookies, but it cannot read the token or set
 * custom headers on cross-site requests (CORS rejects its origin), so it cannot forge requests.
 * SameSite cookies and the CORS origin allow-list are additional layers.
 */
export interface Csrf {
  issueToken(req: Request, res: Response): string;
  protect: RequestHandler;
}

export function createCsrf(key: Buffer, cookieSettings: CookieSettings): Csrf {
  const sign = (nonce: string): string => `${nonce}.${hmacHex(key, nonce)}`;
  const isSigned = (token: string): boolean => {
    const [nonce, signature, extra] = token.split(".");
    return nonce !== undefined && signature !== undefined && extra === undefined && safeEqual(signature, hmacHex(key, nonce));
  };

  return {
    issueToken: (req, res) => {
      const existing = readCookie(req, CSRF_COOKIE);
      const token = existing !== undefined && isSigned(existing) ? existing : sign(randomToken());
      res.cookie(CSRF_COOKIE, token, baseCookieOptions(cookieSettings, "/"));
      return token;
    },

    protect: (req, _res, next) => {
      if (SAFE_METHODS.has(req.method)) {
        next();
        return;
      }
      const header = req.get(CSRF_HEADER);
      const cookie = readCookie(req, CSRF_COOKIE);
      if (header === undefined || cookie === undefined || !safeEqual(header, cookie) || !isSigned(cookie)) {
        throw new HttpError(403, "CSRF_TOKEN_INVALID", "Security token is missing or invalid. Refresh the page and try again.");
      }
      next();
    },
  };
}

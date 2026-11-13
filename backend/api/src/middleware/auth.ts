import type { Request, RequestHandler } from "express";
import { ACCESS_TOKEN_COOKIE } from "../config/auth.js";
import type { UserRole } from "../generated/prisma/client.js";
import type { TokenService } from "../services/token.service.js";
import type { PublicUser, UserService } from "../services/user.service.js";
import { readCookie } from "../utils/authCookies.js";
import { HttpError } from "../utils/httpError.js";

/**
 * Requires a valid access token cookie AND an account that is still ACTIVE.
 * The account is re-checked on every request, so deactivation takes effect immediately.
 */
export function createAuthenticate(deps: { tokens: TokenService; users: UserService }): RequestHandler {
  return async (req, _res, next) => {
    const token = readCookie(req, ACCESS_TOKEN_COOKIE);
    if (token === undefined) {
      throw new HttpError(401, "UNAUTHENTICATED", "Please log in to continue.");
    }
    const result = await deps.tokens.verifyAccessToken(token);
    if (!result.ok) {
      throw result.reason === "expired"
        ? new HttpError(401, "TOKEN_EXPIRED", "Your session has expired.")
        : new HttpError(401, "UNAUTHENTICATED", "Please log in to continue.");
    }
    const user = await deps.users.findActiveById(result.claims.userId);
    if (user === null) {
      throw new HttpError(401, "UNAUTHENTICATED", "Please log in to continue.");
    }
    req.auth = { user };
    next();
  };
}

/** Allows only the given roles. Must run after authenticate. */
export function requireRole(...roles: readonly UserRole[]): RequestHandler {
  return (req, _res, next) => {
    const user = getAuthUser(req);
    if (!roles.includes(user.role)) {
      throw new HttpError(403, "FORBIDDEN", "You do not have permission to do this.");
    }
    next();
  };
}

/** Blocks accounts with an admin-set temporary password until they choose their own. */
export const requirePasswordChanged: RequestHandler = (req, _res, next) => {
  if (getAuthUser(req).mustChangePassword) {
    throw new HttpError(403, "PASSWORD_CHANGE_REQUIRED", "Change your temporary password to continue.");
  }
  next();
};

export function getAuthUser(req: Request): PublicUser {
  const user = req.auth?.user;
  if (user === undefined) {
    throw new HttpError(401, "UNAUTHENTICATED", "Please log in to continue.");
  }
  return user;
}

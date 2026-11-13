import { randomUUID } from "node:crypto";
import { errors as joseErrors, jwtVerify, SignJWT } from "jose";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  JWT_AUDIENCE,
  JWT_ISSUER,
  REFRESH_TOKEN_TTL_SECONDS,
} from "../config/auth.js";
import type { PrismaClient } from "../db/prisma.js";
import type { UserRole } from "../generated/prisma/client.js";
import { randomToken, sha256Hex } from "../utils/crypto.js";
import { addSeconds, type Clock } from "./clock.js";

export interface AccessTokenClaims {
  userId: string;
  role: UserRole;
}

export type AccessTokenResult =
  | { ok: true; claims: AccessTokenClaims }
  | { ok: false; reason: "expired" | "invalid" };

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

export type RotationResult =
  | { ok: true; userId: string; session: IssuedSession }
  | { ok: false; reason: "invalid" | "expired" | "reused" | "inactive" };

export interface TokenService {
  /** Starts a new login session (new refresh-token family). */
  createSession(user: { id: string; role: UserRole }): Promise<IssuedSession>;
  verifyAccessToken(token: string): Promise<AccessTokenResult>;
  /** Exchanges a refresh token for a new one (single use). Reuse revokes the whole session. */
  rotateRefreshToken(refreshToken: string): Promise<RotationResult>;
  /** Revokes the session the given refresh token belongs to (logout). */
  revokeSession(refreshToken: string): Promise<void>;
  /** Revokes every session of a user (password change, deactivation). */
  revokeAllSessions(userId: string): Promise<void>;
}

const VALID_ROLES: readonly UserRole[] = ["CITIZEN", "ADMIN", "ENGINEER"];

class ConcurrentRotationError extends Error {}

export function createTokenService(deps: { prisma: PrismaClient; jwtKey: Uint8Array; clock: Clock }): TokenService {
  const { prisma, jwtKey, clock } = deps;

  const signAccessToken = (user: { id: string; role: UserRole }): Promise<string> => {
    const nowSeconds = Math.floor(clock().getTime() / 1000);
    return new SignJWT({ role: user.role })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(user.id)
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .setIssuedAt(nowSeconds)
      .setExpirationTime(nowSeconds + ACCESS_TOKEN_TTL_SECONDS)
      .sign(jwtKey);
  };

  const revokeFamily = async (familyId: string): Promise<void> => {
    await prisma.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: clock() } });
  };

  const issueSession = async (user: { id: string; role: UserRole }, familyId: string): Promise<IssuedSession> => {
    const refreshToken = randomToken();
    const refreshTokenExpiresAt = addSeconds(clock(), REFRESH_TOKEN_TTL_SECONDS);
    await prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: sha256Hex(refreshToken), familyId, expiresAt: refreshTokenExpiresAt },
    });
    return { accessToken: await signAccessToken(user), refreshToken, refreshTokenExpiresAt };
  };

  return {
    createSession: (user) => issueSession(user, randomUUID()),

    verifyAccessToken: async (token) => {
      try {
        const { payload } = await jwtVerify(token, jwtKey, {
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
          algorithms: ["HS256"],
          currentDate: clock(),
        });
        const role = VALID_ROLES.find((value) => value === payload["role"]);
        if (typeof payload.sub !== "string" || role === undefined) {
          return { ok: false, reason: "invalid" };
        }
        return { ok: true, claims: { userId: payload.sub, role } };
      } catch (error) {
        return { ok: false, reason: error instanceof joseErrors.JWTExpired ? "expired" : "invalid" };
      }
    },

    rotateRefreshToken: async (refreshToken) => {
      const existing = await prisma.refreshToken.findUnique({
        where: { tokenHash: sha256Hex(refreshToken) },
        include: { user: { select: { id: true, role: true, status: true } } },
      });
      if (existing === null) {
        return { ok: false, reason: "invalid" };
      }
      if (existing.revokedAt !== null) {
        // A rotated or revoked token was presented again: assume it was stolen.
        await revokeFamily(existing.familyId);
        return { ok: false, reason: "reused" };
      }
      if (existing.expiresAt <= clock()) {
        return { ok: false, reason: "expired" };
      }
      if (existing.user.status !== "ACTIVE") {
        await revokeFamily(existing.familyId);
        return { ok: false, reason: "inactive" };
      }

      const newRefreshToken = randomToken();
      const refreshTokenExpiresAt = addSeconds(clock(), REFRESH_TOKEN_TTL_SECONDS);
      try {
        await prisma.$transaction(async (tx) => {
          const created = await tx.refreshToken.create({
            data: {
              userId: existing.userId,
              tokenHash: sha256Hex(newRefreshToken),
              familyId: existing.familyId,
              expiresAt: refreshTokenExpiresAt,
            },
          });
          // Conditional update: only one concurrent request can consume the old token.
          const consumed = await tx.refreshToken.updateMany({
            where: { id: existing.id, revokedAt: null },
            data: { revokedAt: clock(), replacedById: created.id },
          });
          if (consumed.count !== 1) {
            throw new ConcurrentRotationError();
          }
        });
      } catch (error) {
        if (error instanceof ConcurrentRotationError) {
          await revokeFamily(existing.familyId);
          return { ok: false, reason: "reused" };
        }
        throw error;
      }

      return {
        ok: true,
        userId: existing.userId,
        session: {
          accessToken: await signAccessToken(existing.user),
          refreshToken: newRefreshToken,
          refreshTokenExpiresAt,
        },
      };
    },

    revokeSession: async (refreshToken) => {
      const existing = await prisma.refreshToken.findUnique({
        where: { tokenHash: sha256Hex(refreshToken) },
        select: { familyId: true },
      });
      if (existing !== null) {
        await revokeFamily(existing.familyId);
      }
    },

    revokeAllSessions: async (userId) => {
      await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: clock() } });
    },
  };
}

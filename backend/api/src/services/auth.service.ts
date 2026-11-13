import type { CountryCode } from "libphonenumber-js/max";
import type { PrismaClient } from "../db/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import { HttpError } from "../utils/httpError.js";
import { normalizeMobileNumber } from "../utils/phone.js";
import type { Clock } from "./clock.js";
import type { OtpIssueResult, OtpService } from "./otp.service.js";
import { hashPassword, verifyPassword } from "./password.service.js";
import type { IssuedSession, TokenService } from "./token.service.js";
import { publicUserSelect, type PublicUser } from "./user.service.js";

export interface RegisterResult extends OtpIssueResult {
  mobileNumber: string;
}

export interface AuthenticatedSession {
  user: PublicUser;
  session: IssuedSession;
}

export interface AuthService {
  registerCitizen(input: { fullName: string; mobileNumber: string; password: string }): Promise<RegisterResult>;
  verifyMobile(input: { mobileNumber: string; code: string }): Promise<void>;
  /** Returns undefined (and sends nothing) when no account is awaiting verification. */
  resendVerificationCode(input: { mobileNumber: string }): Promise<OtpIssueResult | undefined>;
  login(input: { mobileNumber: string; password: string }): Promise<AuthenticatedSession>;
  refresh(refreshToken: string): Promise<AuthenticatedSession>;
  logout(refreshToken: string | undefined): Promise<void>;
  changePassword(userId: string, input: { currentPassword: string; newPassword: string }): Promise<AuthenticatedSession>;
  normalizeMobileOrThrow(mobileNumber: string): string;
}

const INVALID_CREDENTIALS = (): HttpError =>
  new HttpError(401, "INVALID_CREDENTIALS", "Incorrect mobile number or password.");

export function createAuthService(deps: {
  prisma: PrismaClient;
  otp: OtpService;
  tokens: TokenService;
  clock: Clock;
  phoneDefaultCountry: CountryCode | undefined;
}): AuthService {
  const { prisma, otp, tokens, clock, phoneDefaultCountry } = deps;

  const normalizeMobileOrThrow = (mobileNumber: string): string => {
    const normalized = normalizeMobileNumber(mobileNumber, phoneDefaultCountry);
    if (normalized === undefined) {
      const hint = phoneDefaultCountry === undefined ? " Include the country code, for example +1 202 555 0143." : "";
      throw new HttpError(400, "VALIDATION_ERROR", "Some fields are invalid.", {
        details: { fields: { mobileNumber: [`Enter a valid mobile number.${hint}`] }, formErrors: [] },
      });
    }
    return normalized;
  };

  const findPendingCitizen = (mobileNumber: string) =>
    prisma.user.findFirst({
      where: { mobileNumber, role: "CITIZEN", status: "PENDING_VERIFICATION" },
      select: { id: true, mobileNumber: true },
    });

  return {
    normalizeMobileOrThrow,

    registerCitizen: async (input) => {
      const mobileNumber = normalizeMobileOrThrow(input.mobileNumber);
      const passwordHash = await hashPassword(input.password);

      const existing = await prisma.user.findUnique({
        where: { mobileNumber },
        select: { id: true, role: true, status: true },
      });

      let user: { id: string; mobileNumber: string };
      if (existing !== null) {
        if (existing.role !== "CITIZEN" || existing.status !== "PENDING_VERIFICATION") {
          throw new HttpError(409, "MOBILE_ALREADY_REGISTERED", "An account with this mobile number already exists.");
        }
        // An unverified registration does not lock the number: whoever proves ownership with
        // the OTP wins, and the earlier, unproven details are replaced.
        user = await prisma.user.update({
          where: { id: existing.id },
          data: { fullName: input.fullName, passwordHash },
          select: { id: true, mobileNumber: true },
        });
      } else {
        try {
          user = await prisma.user.create({
            data: { fullName: input.fullName, mobileNumber, passwordHash, role: "CITIZEN", status: "PENDING_VERIFICATION" },
            select: { id: true, mobileNumber: true },
          });
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            throw new HttpError(409, "MOBILE_ALREADY_REGISTERED", "An account with this mobile number already exists.");
          }
          throw error;
        }
      }

      const issued = await otp.issueMobileVerificationCode(user);
      return { mobileNumber, ...issued };
    },

    verifyMobile: async (input) => {
      const mobileNumber = normalizeMobileOrThrow(input.mobileNumber);
      const user = await findPendingCitizen(mobileNumber);
      if (user === null) {
        throw new HttpError(400, "OTP_INVALID", "The code is invalid or has already been used. Request a new code.");
      }
      await otp.verifyMobileVerificationCode(user.id, input.code);
      await prisma.user.update({
        where: { id: user.id },
        data: { status: "ACTIVE", mobileVerifiedAt: clock() },
      });
    },

    resendVerificationCode: async (input) => {
      const mobileNumber = normalizeMobileOrThrow(input.mobileNumber);
      const user = await findPendingCitizen(mobileNumber);
      return user === null ? undefined : otp.issueMobileVerificationCode(user);
    },

    login: async (input) => {
      const mobileNumber = normalizeMobileNumber(input.mobileNumber, phoneDefaultCountry);
      const account =
        mobileNumber === undefined
          ? null
          : await prisma.user.findUnique({
              where: { mobileNumber },
              select: { ...publicUserSelect, passwordHash: true },
            });

      // Always run a hash verification so timing does not reveal whether the account exists.
      const passwordOk = await verifyPassword(account?.passwordHash, input.password);
      if (account === null || !passwordOk) {
        throw INVALID_CREDENTIALS();
      }

      // Status is only revealed after the correct password has been given.
      if (account.status === "PENDING_VERIFICATION") {
        throw new HttpError(403, "ACCOUNT_NOT_VERIFIED", "Verify your mobile number before logging in.", {
          details: { mobileNumber: account.mobileNumber },
        });
      }
      if (account.status === "DEACTIVATED") {
        throw new HttpError(403, "ACCOUNT_DEACTIVATED", "This account has been deactivated. Contact an administrator.");
      }

      const { passwordHash: _passwordHash, ...user } = account;
      return { user, session: await tokens.createSession(user) };
    },

    refresh: async (refreshToken) => {
      const result = await tokens.rotateRefreshToken(refreshToken);
      if (!result.ok) {
        throw new HttpError(401, "SESSION_INVALID", "Your session has ended. Please log in again.");
      }
      const user = await prisma.user.findFirst({
        where: { id: result.userId, status: "ACTIVE" },
        select: publicUserSelect,
      });
      if (user === null) {
        await tokens.revokeSession(result.session.refreshToken);
        throw new HttpError(401, "SESSION_INVALID", "Your session has ended. Please log in again.");
      }
      return { user, session: result.session };
    },

    logout: async (refreshToken) => {
      if (refreshToken !== undefined) {
        await tokens.revokeSession(refreshToken);
      }
    },

    changePassword: async (userId, input) => {
      const account = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { passwordHash: true },
      });
      if (!(await verifyPassword(account.passwordHash, input.currentPassword))) {
        throw new HttpError(400, "VALIDATION_ERROR", "Some fields are invalid.", {
          details: { fields: { currentPassword: ["Current password is incorrect."] }, formErrors: [] },
        });
      }
      const passwordHash = await hashPassword(input.newPassword);
      const user = await prisma.user.update({
        where: { id: userId },
        data: { passwordHash, mustChangePassword: false },
        select: publicUserSelect,
      });
      // Log out every other device; the current device gets a fresh session.
      await tokens.revokeAllSessions(userId);
      return { user, session: await tokens.createSession(user) };
    },
  };
}

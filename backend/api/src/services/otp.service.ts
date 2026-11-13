import { randomInt } from "node:crypto";
import {
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_SENDS_PER_HOUR,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_SECONDS,
} from "../config/auth.js";
import type { PrismaClient } from "../db/prisma.js";
import { hmacHex, safeEqual } from "../utils/crypto.js";
import { HttpError } from "../utils/httpError.js";
import { addSeconds, type Clock } from "./clock.js";
import type { SmsSender } from "./sms/index.js";

export interface OtpIssueResult {
  expiresAt: Date;
  resendAvailableAt: Date;
}

export interface OtpService {
  /** Generates, stores (hashed) and sends a new code. Enforces resend cooldown and hourly limit. */
  issueMobileVerificationCode(user: { id: string; mobileNumber: string }): Promise<OtpIssueResult>;
  /** Checks a code. On success the code is consumed and can never be used again. */
  verifyMobileVerificationCode(userId: string, code: string): Promise<void>;
}

const PURPOSE = "MOBILE_VERIFICATION" as const;

export function createOtpService(deps: {
  prisma: PrismaClient;
  sms: SmsSender;
  otpKey: Buffer;
  clock: Clock;
}): OtpService {
  const { prisma, sms, otpKey, clock } = deps;
  // Binding the code to the user means a hash is useless for any other account.
  const hashCode = (userId: string, code: string): string => hmacHex(otpKey, `${PURPOSE}:${userId}:${code}`);

  return {
    issueMobileVerificationCode: async (user) => {
      const now = clock();
      const lastHour = addSeconds(now, -3600);
      const recent = await prisma.otpCode.findMany({
        where: { userId: user.id, purpose: PURPOSE, createdAt: { gt: lastHour } },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });

      const latest = recent[0];
      if (latest !== undefined) {
        const cooldownEndsAt = addSeconds(latest.createdAt, OTP_RESEND_COOLDOWN_SECONDS);
        if (cooldownEndsAt > now) {
          const retryAfterSeconds = Math.ceil((cooldownEndsAt.getTime() - now.getTime()) / 1000);
          throw new HttpError(429, "OTP_RESEND_TOO_SOON", `Please wait ${retryAfterSeconds} seconds before requesting a new code.`, {
            details: { retryAfterSeconds },
          });
        }
      }
      if (recent.length >= OTP_MAX_SENDS_PER_HOUR) {
        const oldest = recent[recent.length - 1];
        const retryAfterSeconds = oldest === undefined ? 3600 : Math.ceil((oldest.createdAt.getTime() + 3_600_000 - now.getTime()) / 1000);
        throw new HttpError(429, "OTP_RESEND_LIMIT", "Too many codes requested. Please try again later.", {
          details: { retryAfterSeconds },
        });
      }

      const code = randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, "0");
      const expiresAt = addSeconds(now, OTP_TTL_SECONDS);

      await prisma.$transaction([
        // Only the newest code is ever valid.
        prisma.otpCode.updateMany({
          where: { userId: user.id, purpose: PURPOSE, consumedAt: null },
          data: { consumedAt: now },
        }),
        prisma.otpCode.create({
          data: { userId: user.id, purpose: PURPOSE, codeHash: hashCode(user.id, code), expiresAt, createdAt: now },
        }),
      ]);

      try {
        await sms.send(
          user.mobileNumber,
          `Your Road Damage verification code is ${code}. It expires in ${OTP_TTL_SECONDS / 60} minutes. Do not share it.`,
        );
      } catch (error) {
        throw new HttpError(503, "SMS_UNAVAILABLE", "The verification code could not be sent. Please try again later.", {
          cause: error,
        });
      }

      return { expiresAt, resendAvailableAt: addSeconds(now, OTP_RESEND_COOLDOWN_SECONDS) };
    },

    verifyMobileVerificationCode: async (userId, code) => {
      const now = clock();
      const current = await prisma.otpCode.findFirst({
        where: { userId, purpose: PURPOSE, consumedAt: null },
        orderBy: { createdAt: "desc" },
      });

      if (current === null) {
        throw new HttpError(400, "OTP_INVALID", "The code is invalid or has already been used. Request a new code.");
      }
      if (current.expiresAt <= now) {
        throw new HttpError(400, "OTP_EXPIRED", "The code has expired. Request a new code.");
      }
      if (current.attempts >= OTP_MAX_ATTEMPTS) {
        throw new HttpError(400, "OTP_ATTEMPTS_EXCEEDED", "Too many incorrect attempts. Request a new code.");
      }

      if (!safeEqual(current.codeHash, hashCode(userId, code))) {
        const updated = await prisma.otpCode.update({
          where: { id: current.id },
          data: { attempts: { increment: 1 } },
          select: { attempts: true },
        });
        const attemptsRemaining = Math.max(0, OTP_MAX_ATTEMPTS - updated.attempts);
        if (attemptsRemaining === 0) {
          await prisma.otpCode.update({ where: { id: current.id }, data: { consumedAt: now } });
          throw new HttpError(400, "OTP_ATTEMPTS_EXCEEDED", "Too many incorrect attempts. Request a new code.");
        }
        throw new HttpError(400, "OTP_INVALID", "The code is incorrect.", { details: { attemptsRemaining } });
      }

      // Conditional update so a code can be consumed only once, even with concurrent requests.
      const consumed = await prisma.otpCode.updateMany({
        where: { id: current.id, consumedAt: null, attempts: { lt: OTP_MAX_ATTEMPTS } },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) {
        throw new HttpError(400, "OTP_INVALID", "The code is invalid or has already been used. Request a new code.");
      }
    },
  };
}

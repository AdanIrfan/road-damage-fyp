import type { CountryCode } from "libphonenumber-js/max";
import type { PrismaClient } from "../db/prisma.js";
import { deriveKey } from "../utils/crypto.js";
import type { AiClient } from "./ai/aiClient.js";
import { createAuthService, type AuthService } from "./auth.service.js";
import { systemClock, type Clock } from "./clock.js";
import { createEngineerService, type EngineerService } from "./engineer.service.js";
import { createOtpService } from "./otp.service.js";
import { createReportService, type ReportLocationSettings, type ReportService } from "./report.service.js";
import type { SmsSender } from "./sms/index.js";
import type { FileStorage } from "./storage/fileStorage.js";
import { createTokenService, type TokenService } from "./token.service.js";
import { createUserService, type UserService } from "./user.service.js";

export interface Services {
  auth: AuthService;
  tokens: TokenService;
  users: UserService;
  engineers: EngineerService;
  reports: ReportService;
  /** Key for signing CSRF tokens (derived from AUTH_SECRET). */
  csrfKey: Buffer;
}

export interface ServiceDependencies {
  prisma: PrismaClient;
  authSecret: string;
  sms: SmsSender;
  phoneDefaultCountry: CountryCode | undefined;
  /** Client for the internal AI inference service. */
  ai: AiClient;
  /** Where uploaded images are stored. */
  storage: FileStorage;
  location: ReportLocationSettings;
  clock?: Clock;
}

/** Wires all application services. Called once at startup (and by tests with fakes). */
export function createServices(deps: ServiceDependencies): Services {
  const clock = deps.clock ?? systemClock;
  const tokens = createTokenService({
    prisma: deps.prisma,
    jwtKey: new Uint8Array(deriveKey(deps.authSecret, "jwt-access-token")),
    clock,
  });
  const otp = createOtpService({ prisma: deps.prisma, sms: deps.sms, otpKey: deriveKey(deps.authSecret, "otp"), clock });

  return {
    auth: createAuthService({ prisma: deps.prisma, otp, tokens, clock, phoneDefaultCountry: deps.phoneDefaultCountry }),
    tokens,
    users: createUserService(deps.prisma),
    engineers: createEngineerService({ prisma: deps.prisma, tokens }),
    reports: createReportService({ prisma: deps.prisma, ai: deps.ai, storage: deps.storage, clock, location: deps.location }),
    csrfKey: deriveKey(deps.authSecret, "csrf"),
  };
}

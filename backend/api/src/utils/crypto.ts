import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Derives an independent 256-bit key for one purpose from the master AUTH_SECRET,
 * so the JWT, OTP and CSRF keys are never the same value.
 */
export function deriveKey(masterSecret: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", masterSecret, "road-damage-api", purpose, 32));
}

/** Cryptographically secure random token, URL-safe. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hmacHex(key: Buffer, value: string): string {
  return createHmac("sha256", key).update(value).digest("hex");
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer);
}

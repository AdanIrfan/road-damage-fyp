/** Authentication constants. Changing these affects security; discuss before changing. */

/** Access token (JWT in an httpOnly cookie): short-lived. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
/** Refresh token (random, stored hashed in PostgreSQL): rotated on every use. */
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

export const JWT_ISSUER = "road-damage-api";
export const JWT_AUDIENCE = "road-damage-web";

export const OTP_LENGTH = 6;
export const OTP_TTL_SECONDS = 10 * 60;
/** Wrong guesses allowed per code; after this the code is burned and a new one must be requested. */
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;
export const OTP_MAX_SENDS_PER_HOUR = 5;

export const PASSWORD_MIN_LENGTH = 8;
/** Upper bound protects the server from very expensive hashes. */
export const PASSWORD_MAX_LENGTH = 128;

export const ACCESS_TOKEN_COOKIE = "access_token";
export const REFRESH_TOKEN_COOKIE = "refresh_token";
export const CSRF_COOKIE = "csrf_token";
export const CSRF_HEADER = "x-csrf-token";

/** Access cookie is sent to every API route; refresh cookie only to the auth routes that need it. */
export const ACCESS_TOKEN_COOKIE_PATH = "/api";
export const REFRESH_TOKEN_COOKIE_PATH = "/api/v1/auth";

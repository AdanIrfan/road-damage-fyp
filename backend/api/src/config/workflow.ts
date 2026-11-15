/** Stage 4 workflow limits (agreed with the owner on 2026-11-14). */

/** Reason for Reject / Delay (required) — shown to the citizen and sent (shortened) by SMS. */
export const DECISION_REASON_MAX_LENGTH = 500;
/** Optional admin notes: accept note, completion-confirmation note, assignment reason. */
export const ADMIN_NOTE_MAX_LENGTH = 500;
/** "Needs more work" feedback from an admin. */
export const FEEDBACK_MAX_LENGTH = 1000;
/** Engineer progress notes. */
export const REPAIR_NOTE_MAX_LENGTH = 1000;

/** Each repair attempt needs 1..5 photos of its own before it can be marked Completed. */
export const MIN_REPAIR_PHOTOS_TO_COMPLETE = 1;
export const MAX_REPAIR_PHOTOS_PER_ATTEMPT = 5;
/** Repair photo uploads per engineer (keyed by user id, in memory). */
export const REPAIR_PHOTO_RATE_LIMIT = { windowMinutes: 60, limit: 30 } as const;

/** Reasons are shortened to this length in SMS messages (the full text is in the app). */
export const SMS_REASON_MAX_LENGTH = 120;

export const ADMIN_REPORT_LIST_MAX_PAGE_SIZE = 50;
export const ADMIN_DASHBOARD_RECENT_COUNT = 5;

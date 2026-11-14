/**
 * Report submission constants (agreed with the owner on 2026-11-14).
 * Location thresholds and the AI service address are environment variables (src/config/env.ts).
 */

/** One photo per report, at most 10 MB. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** Longest accepted image side, in pixels. */
export const MAX_IMAGE_DIMENSION = 8000;
/** Detected from the file content (magic bytes), never from the name or the client's MIME type. */
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png"] as const;
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];
/** Quality of the metadata-free JPEG copy that is shown to users and analysed by the AI service. */
export const DISPLAY_JPEG_QUALITY = 85;

export const DESCRIPTION_MAX_LENGTH = 1000;

/** Report submissions per citizen (keyed by user id, in memory). */
export const REPORT_RATE_LIMIT = { windowMinutes: 60, limit: 10 } as const;

export const REPORT_LIST_MAX_PAGE_SIZE = 50;

/**
 * Initial heuristic severity (CLAUDE.md §6). This is an ESTIMATE, not an engineering measurement.
 *
 *   score = Σ over detections of  areaFraction × confidence × classWeight[className]
 *   score ≥ high → HIGH,  score ≥ medium → MEDIUM,  score > 0 → LOW,  no detections → no severity
 *
 * Class names come from the model. A class missing from this table (e.g. after a model change)
 * gets `unknownClassWeight`, which is deliberately not lower than any known class so unknown
 * damage is never down-weighted.
 */
export const SEVERITY_CONFIG = {
  classWeights: {
    pothole: 1.0,
    alligator_crack: 0.8,
    longitudinal_crack: 0.5,
    transverse_crack: 0.5,
  } as Readonly<Record<string, number>>,
  unknownClassWeight: 1.0,
  thresholds: { high: 0.15, medium: 0.05 },
} as const;

export type SeverityConfig = typeof SEVERITY_CONFIG;

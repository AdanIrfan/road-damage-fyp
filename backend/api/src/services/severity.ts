import { SEVERITY_CONFIG, type SeverityConfig } from "../config/reports.js";
import type { SeverityLevel } from "../generated/prisma/client.js";

export interface SeverityDetection {
  className: string;
  confidence: number;
  /** Box area divided by image area (0..1). */
  areaFraction: number;
}

export interface SeverityEstimate {
  /** Null when there are no detections (no damage detected). */
  level: SeverityLevel | null;
  score: number;
}

/**
 * Initial ESTIMATED severity from AI detections (heuristic, not an engineering measurement).
 * The formula and its thresholds live in SEVERITY_CONFIG (src/config/reports.ts).
 */
export function estimateSeverity(
  detections: readonly SeverityDetection[],
  config: SeverityConfig = SEVERITY_CONFIG,
): SeverityEstimate {
  const score = detections.reduce((sum, detection) => {
    const weight = config.classWeights[detection.className] ?? config.unknownClassWeight;
    return sum + clamp01(detection.areaFraction) * clamp01(detection.confidence) * weight;
  }, 0);

  let level: SeverityLevel | null = null;
  if (detections.length > 0) {
    if (score >= config.thresholds.high) {
      level = "HIGH";
    } else if (score >= config.thresholds.medium) {
      level = "MEDIUM";
    } else {
      level = "LOW";
    }
  }
  return { level, score: Math.round(score * 1e6) / 1e6 };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

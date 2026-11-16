import type { AiDetectionResult } from "./ai/aiClient.js";

/** A detection as stored in `ai_detections` (without the report and image ids). */
export interface DetectionRow {
  classId: number;
  className: string;
  confidence: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Box area divided by the display image area, clamped to 0-1. */
  areaFraction: number;
}

/** Converts the AI service's detections into rows; used at submission and when an admin retries. */
export function toDetectionRows(detections: readonly AiDetectionResult[], imageWidth: number, imageHeight: number): DetectionRow[] {
  const imageArea = imageWidth * imageHeight;
  return detections.map((d) => ({
    classId: d.classId,
    className: d.className,
    confidence: d.confidence,
    x1: d.box.x1,
    y1: d.box.y1,
    x2: d.box.x2,
    y2: d.box.y2,
    areaFraction: Math.min(1, Math.max(0, ((d.box.x2 - d.box.x1) * (d.box.y2 - d.box.y1)) / imageArea)),
  }));
}

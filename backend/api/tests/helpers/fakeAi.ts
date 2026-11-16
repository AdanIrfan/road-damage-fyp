import type { AiAnalysis, AiClient, AiDetectionResult, AiHealth } from "../../src/services/ai/aiClient.js";

export const MODEL_CLASSES = ["longitudinal_crack", "transverse_crack", "alligator_crack", "pothole"];

/**
 * Stands in for the FastAPI service in API tests. By default it answers like the real service
 * with no detections, using the size of the image it was sent.
 */
export class FakeAiClient implements AiClient {
  readonly calls: { image: Buffer; contentType: string }[] = [];
  detections: AiDetectionResult[] = [];
  /** When set, analyze() rejects with this error instead of answering. */
  failWith: Error | undefined;
  /** When set, the reported image size (to simulate a mismatching answer). */
  reportedSize: { width: number; height: number } | undefined;

  async analyze(image: Buffer, contentType: string): Promise<AiAnalysis> {
    this.calls.push({ image, contentType });
    if (this.failWith !== undefined) {
      throw this.failWith;
    }
    const { default: sharp } = await import("sharp");
    const { width = 0, height = 0 } = await sharp(image).metadata();
    return {
      model: { name: "best", task: "detect", classes: MODEL_CLASSES },
      image: this.reportedSize ?? { width, height },
      thresholds: { confidence: 0.25, iou: 0.7 },
      detections: this.detections,
      inferenceMs: 1,
    };
  }

  /** What health() answers. */
  healthStatus: AiHealth = { status: "online", modelLoaded: true };

  health(): Promise<AiHealth> {
    return Promise.resolve(this.healthStatus);
  }

  reset(): void {
    this.healthStatus = { status: "online", modelLoaded: true };
    this.calls.length = 0;
    this.detections = [];
    this.failWith = undefined;
    this.reportedSize = undefined;
  }
}

export function detection(className: string, confidence: number, box: [number, number, number, number]): AiDetectionResult {
  const classId = MODEL_CLASSES.indexOf(className);
  if (classId < 0) {
    throw new Error(`Unknown class ${className}`);
  }
  const [x1, y1, x2, y2] = box;
  return { classId, className, confidence, box: { x1, y1, x2, y2 } };
}

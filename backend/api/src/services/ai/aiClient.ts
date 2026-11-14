import { z } from "zod";

/** Header that carries the shared secret. Must match backend/ai/app/security.py. */
export const AI_SECRET_HEADER = "X-AI-Service-Key";
/** Largest AI response we accept; a normal response is a few kilobytes. */
const MAX_RESPONSE_BYTES = 1024 * 1024;

export interface AiBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface AiDetectionResult {
  classId: number;
  className: string;
  confidence: number;
  box: AiBox;
}

export interface AiAnalysis {
  model: { name: string; task: string; classes: string[] };
  image: { width: number; height: number };
  thresholds: { confidence: number; iou: number };
  detections: AiDetectionResult[];
  inferenceMs: number;
}

/**
 * unavailable: network error or 5xx;  timeout: no answer in time;
 * rejected: 4xx (e.g. wrong secret, image refused);  invalid_response: not the agreed shape.
 */
export type AiErrorKind = "unavailable" | "timeout" | "rejected" | "invalid_response";

export class AiServiceError extends Error {
  readonly kind: AiErrorKind;

  constructor(kind: AiErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AiServiceError";
    this.kind = kind;
  }
}

export interface AiClient {
  /** Sends an image to the AI service and returns its validated detections. */
  analyze(image: Buffer, contentType: string): Promise<AiAnalysis>;
}

const finite = z.number().finite();

/** The exact response shape of POST /v1/detect (backend/ai/app/schemas.py). */
const aiResponseSchema = z
  .object({
    model: z.object({
      name: z.string().min(1).max(100),
      task: z.literal("detect"),
      classes: z.array(z.string().min(1).max(100)).min(1).max(1000),
    }),
    image: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
    thresholds: z.object({ confidence: finite.min(0).max(1), iou: finite.min(0).max(1) }),
    detections: z
      .array(
        z.object({
          class_id: z.number().int().min(0),
          class_name: z.string().min(1).max(100),
          confidence: finite.min(0).max(1),
          box: z.object({ x1: finite, y1: finite, x2: finite, y2: finite }),
        }),
      )
      .max(1000),
    inference_ms: finite.min(0),
  })
  .superRefine((data, ctx) => {
    data.detections.forEach((detection, index) => {
      if (data.model.classes[detection.class_id] !== detection.class_name) {
        ctx.addIssue({ code: "custom", path: ["detections", index], message: "class does not match the model's classes" });
      }
      const { x1, y1, x2, y2 } = detection.box;
      // Allow one pixel of rounding slack at the image border.
      const inside = x1 >= -1 && y1 >= -1 && x2 <= data.image.width + 1 && y2 <= data.image.height + 1;
      if (!(x2 > x1 && y2 > y1 && inside)) {
        ctx.addIssue({ code: "custom", path: ["detections", index, "box"], message: "box is outside the image" });
      }
    });
  });

export interface HttpAiClientOptions {
  /** Base URL of the AI service, e.g. http://127.0.0.1:8000 (no trailing slash). */
  baseUrl: string;
  secret: string;
  timeoutMs: number;
}

/** Calls the FastAPI inference service over HTTP. The secret and URL never reach the browser. */
export function createHttpAiClient(options: HttpAiClientOptions): AiClient {
  const endpoint = `${options.baseUrl}/v1/detect`;

  return {
    analyze: async (image, contentType) => {
      const form = new FormData();
      // The file name is fixed: nothing from the client's upload is forwarded.
      form.append("image", new Blob([new Uint8Array(image)], { type: contentType }), "image.jpg");

      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: { [AI_SECRET_HEADER]: options.secret, Accept: "application/json" },
          body: form,
          signal: AbortSignal.timeout(options.timeoutMs),
          redirect: "error",
        });
      } catch (error) {
        if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
          throw new AiServiceError("timeout", `AI service did not answer within ${options.timeoutMs} ms`, { cause: error });
        }
        throw new AiServiceError("unavailable", "AI service is unreachable", { cause: error });
      }

      let text: string;
      try {
        text = await readLimitedText(response);
      } catch (error) {
        if (error instanceof AiServiceError) {
          throw error;
        }
        const timedOut = error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError");
        throw new AiServiceError(timedOut ? "timeout" : "unavailable", "AI service response could not be read", { cause: error });
      }

      if (!response.ok) {
        throw new AiServiceError(
          response.status >= 500 ? "unavailable" : "rejected",
          `AI service answered HTTP ${response.status}`,
        );
      }

      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch (error) {
        throw new AiServiceError("invalid_response", "AI service returned invalid JSON", { cause: error });
      }
      const parsed = aiResponseSchema.safeParse(json);
      if (!parsed.success) {
        throw new AiServiceError("invalid_response", "AI service response has an unexpected shape", { cause: parsed.error });
      }

      const data = parsed.data;
      return {
        model: data.model,
        image: data.image,
        thresholds: data.thresholds,
        detections: data.detections.map((d) => ({
          classId: d.class_id,
          className: d.class_name,
          confidence: d.confidence,
          box: d.box,
        })),
        inferenceMs: data.inference_ms,
      };
    },
  };
}

async function readLimitedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_RESPONSE_BYTES) {
    throw new AiServiceError("invalid_response", "AI service response is too large");
  }
  const reader = response.body?.getReader();
  if (reader === undefined) {
    return "";
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new AiServiceError("invalid_response", "AI service response is too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Used when no AI service is configured (test environment only): every analysis fails honestly. */
export const unconfiguredAiClient: AiClient = {
  analyze: () => Promise.reject(new AiServiceError("unavailable", "AI service is not configured")),
};

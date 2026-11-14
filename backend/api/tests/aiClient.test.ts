import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, it } from "node:test";
import { AI_SECRET_HEADER, AiServiceError, createHttpAiClient, type AiErrorKind } from "../src/services/ai/aiClient.js";

const SECRET = "fake-ai-secret-that-is-at-least-32-characters";

const validBody = {
  model: { name: "best", task: "detect", classes: ["longitudinal_crack", "transverse_crack", "alligator_crack", "pothole"] },
  image: { width: 1200, height: 1600 },
  thresholds: { confidence: 0.25, iou: 0.7 },
  detections: [{ class_id: 3, class_name: "pothole", confidence: 0.6882, box: { x1: 402, y1: 322, x2: 865, y2: 505 } }],
  inference_ms: 157,
};

type Handler = (req: IncomingMessage, res: ServerResponse, body: Buffer) => void;

describe("HTTP AI client", () => {
  let server: Server;
  let baseUrl: string;
  let handler: Handler;
  let lastRequest: { headers: IncomingMessage["headers"]; body: Buffer; url: string | undefined } | undefined;

  const json = (status: number, body: unknown): Handler => (_req, res) => {
    res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
  };

  before(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const body = Buffer.concat(chunks);
        lastRequest = { headers: req.headers, body, url: req.url };
        handler(req, res, body);
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  beforeEach(() => {
    lastRequest = undefined;
    handler = json(200, validBody);
  });

  const client = (timeoutMs = 2000) => createHttpAiClient({ baseUrl, secret: SECRET, timeoutMs });

  async function expectKind(promise: Promise<unknown>, kind: AiErrorKind): Promise<void> {
    await assert.rejects(promise, (error: unknown) => {
      assert.ok(error instanceof AiServiceError, String(error));
      assert.equal(error.kind, kind);
      return true;
    });
  }

  it("sends the image as multipart with the secret header and maps the response", async () => {
    const result = await client().analyze(Buffer.from("jpeg-bytes"), "image/jpeg");
    assert.equal(lastRequest?.url, "/v1/detect");
    assert.equal(lastRequest?.headers[AI_SECRET_HEADER.toLowerCase()], SECRET);
    assert.match(String(lastRequest?.headers["content-type"]), /^multipart\/form-data; boundary=/);
    assert.ok(lastRequest?.body.includes(Buffer.from("jpeg-bytes")));
    assert.ok(lastRequest?.body.includes(Buffer.from('name="image"')));
    assert.deepEqual(result.detections, [
      { classId: 3, className: "pothole", confidence: 0.6882, box: { x1: 402, y1: 322, x2: 865, y2: 505 } },
    ]);
    assert.deepEqual(result.image, { width: 1200, height: 1600 });
    assert.equal(result.model.name, "best");
    assert.equal(result.inferenceMs, 157);
  });

  it("accepts a valid response with no detections", async () => {
    handler = json(200, { ...validBody, detections: [] });
    assert.deepEqual((await client().analyze(Buffer.from("x"), "image/jpeg")).detections, []);
  });

  it("reports an unreachable service as unavailable", async () => {
    const unreachable = createHttpAiClient({ baseUrl: "http://127.0.0.1:1", secret: SECRET, timeoutMs: 2000 });
    await expectKind(unreachable.analyze(Buffer.from("x"), "image/jpeg"), "unavailable");
  });

  it("times out when the service does not answer in time", async () => {
    handler = (_req, res) => {
      setTimeout(() => res.writeHead(200).end("{}"), 500);
    };
    await expectKind(client(100).analyze(Buffer.from("x"), "image/jpeg"), "timeout");
  });

  it("maps 5xx to unavailable and 4xx to rejected", async () => {
    handler = json(503, { error: { code: "MODEL_NOT_LOADED", message: "x" } });
    await expectKind(client().analyze(Buffer.from("x"), "image/jpeg"), "unavailable");
    handler = json(401, { error: { code: "UNAUTHORIZED", message: "x" } });
    await expectKind(client().analyze(Buffer.from("x"), "image/jpeg"), "rejected");
  });

  it("rejects malformed JSON", async () => {
    handler = (_req, res) => res.writeHead(200, { "content-type": "application/json" }).end("{not json");
    await expectKind(client().analyze(Buffer.from("x"), "image/jpeg"), "invalid_response");
  });

  it("rejects responses with the wrong shape or impossible values", async () => {
    const bad: unknown[] = [
      {},
      { ...validBody, detections: "none" },
      { ...validBody, model: { ...validBody.model, task: "segment" } },
      { ...validBody, detections: [{ ...validBody.detections[0], confidence: 1.5 }] },
      { ...validBody, detections: [{ ...validBody.detections[0], class_name: "unicorn" }] },
      { ...validBody, detections: [{ ...validBody.detections[0], class_id: 9 }] },
      { ...validBody, detections: [{ ...validBody.detections[0], box: { x1: 500, y1: 10, x2: 400, y2: 20 } }] },
      { ...validBody, detections: [{ ...validBody.detections[0], box: { x1: 0, y1: 0, x2: 5000, y2: 20 } }] },
      { ...validBody, image: { width: 0, height: 10 } },
    ];
    for (const body of bad) {
      handler = json(200, body);
      await expectKind(client().analyze(Buffer.from("x"), "image/jpeg"), "invalid_response");
    }
  });

  it("rejects oversized responses", async () => {
    handler = json(200, { ...validBody, padding: "x".repeat(2 * 1024 * 1024) });
    await expectKind(client().analyze(Buffer.from("x"), "image/jpeg"), "invalid_response");
  });
});

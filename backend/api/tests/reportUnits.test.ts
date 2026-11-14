import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import { SEVERITY_CONFIG } from "../src/config/reports.js";
import { detectImageType } from "../src/services/images/detectImageType.js";
import { createDisplayCopy } from "../src/services/images/processImage.js";
import { readExifGps } from "../src/services/location/exifGps.js";
import { haversineMeters } from "../src/services/location/haversine.js";
import { verifyGalleryLocation, verifyLiveLocation } from "../src/services/location/verifyLocation.js";
import { estimateSeverity } from "../src/services/severity.js";
import { isValidStorageKey } from "../src/services/storage/fileStorage.js";
import { HttpError } from "../src/utils/httpError.js";
import { makeJpeg, makeJpegWithGps, makePng } from "./helpers/testImages.js";

describe("estimateSeverity (heuristic estimate)", () => {
  const d = (className: string, confidence: number, areaFraction: number) => ({ className, confidence, areaFraction });

  it("returns no severity when there are no detections", () => {
    assert.deepEqual(estimateSeverity([]), { level: null, score: 0 });
  });

  it("weights area × confidence × class weight and applies the agreed thresholds", () => {
    // The real pothole test photo: 4.4% of the image at confidence 0.6882 → 0.0303 → LOW.
    const real = estimateSeverity([d("pothole", 0.6882, 0.044)]);
    assert.equal(real.level, "LOW");
    assert.ok(Math.abs(real.score - 0.0302808) < 1e-6);

    assert.equal(estimateSeverity([d("pothole", 1, 0.05)]).level, "MEDIUM"); // exactly the MEDIUM threshold
    assert.equal(estimateSeverity([d("pothole", 1, 0.15)]).level, "HIGH"); // exactly the HIGH threshold
    assert.equal(estimateSeverity([d("longitudinal_crack", 1, 0.2)]).level, "MEDIUM"); // 0.2 × 0.5 = 0.10
    assert.equal(estimateSeverity([d("alligator_crack", 0.5, 0.4)]).level, "HIGH"); // 0.4 × 0.5 × 0.8 = 0.16
  });

  it("adds up several detections", () => {
    const one = d("transverse_crack", 0.8, 0.05); // 0.02
    assert.equal(estimateSeverity([one]).level, "LOW");
    assert.equal(estimateSeverity([one, one, one]).level, "MEDIUM"); // 0.06
  });

  it("uses the conservative weight for classes it does not know", () => {
    assert.equal(SEVERITY_CONFIG.unknownClassWeight, 1);
    assert.equal(estimateSeverity([d("new_class", 1, 0.15)]).level, "HIGH");
  });

  it("clamps out-of-range inputs", () => {
    assert.equal(estimateSeverity([d("pothole", 2, 5)]).score, 1);
  });
});

describe("location verification", () => {
  it("computes great-circle distances", () => {
    // London → Paris is about 344 km.
    const km = haversineMeters({ latitude: 51.5074, longitude: -0.1278 }, { latitude: 48.8566, longitude: 2.3522 }) / 1000;
    assert.ok(km > 340 && km < 346, String(km));
    assert.equal(haversineMeters({ latitude: 10, longitude: 10 }, { latitude: 10, longitude: 10 }), 0);
  });

  it("marks gallery uploads verified within the tolerance and mismatched beyond it", () => {
    const selected = { latitude: 51.5007, longitude: -0.1246 };
    const near = verifyGalleryLocation(selected, { latitude: 51.51, longitude: -0.12 }, 2);
    assert.equal(near.status, "VERIFIED");
    assert.equal(near.needsReview, false);
    assert.ok(near.distanceMeters !== null && near.distanceMeters < 2000);

    const far = verifyGalleryLocation(selected, { latitude: 51.6, longitude: -0.12 }, 2);
    assert.equal(far.status, "MISMATCH");
    assert.equal(far.needsReview, true);
  });

  it("flags gallery uploads without EXIF GPS for review (never rejects)", () => {
    assert.deepEqual(verifyGalleryLocation({ latitude: 1, longitude: 1 }, null, 2), {
      status: "NO_METADATA",
      needsReview: true,
      distanceMeters: null,
    });
  });

  it("uses BROWSER_GPS for live camera and flags poor accuracy only", () => {
    assert.deepEqual(verifyLiveLocation(20, 100), { status: "BROWSER_GPS", needsReview: false, distanceMeters: null });
    assert.equal(verifyLiveLocation(100, 100).needsReview, false);
    assert.equal(verifyLiveLocation(150, 100).needsReview, true);
  });
});

describe("image handling", () => {
  it("detects JPEG and PNG from their content only", async () => {
    assert.equal(detectImageType(await makeJpeg()), "image/jpeg");
    assert.equal(detectImageType(await makePng()), "image/png");
    assert.equal(detectImageType(Buffer.from("GIF89a....")), null);
    assert.equal(detectImageType(Buffer.from("<svg></svg>")), null);
    assert.equal(detectImageType(Buffer.alloc(0)), null);
  });

  it("reads EXIF GPS from the original photo", async () => {
    const gps = await readExifGps(await makeJpegWithGps(51.5007, -0.1246));
    assert.ok(gps !== null);
    assert.ok(Math.abs(gps.latitude - 51.5007) < 1e-4 && Math.abs(gps.longitude + 0.1246) < 1e-4);
    const south = await readExifGps(await makeJpegWithGps(-33.8568, 151.2153));
    assert.ok(south !== null && south.latitude < 0 && south.longitude > 0);
    assert.equal(await readExifGps(await makeJpeg()), null);
    assert.equal(await readExifGps(await makeJpegWithGps(0, 0)), null);
    assert.equal(await readExifGps(Buffer.from("not an image")), null);
  });

  it("creates a display copy without any metadata", async () => {
    const original = await makeJpegWithGps(51.5007, -0.1246, 300, 150);
    const display = await createDisplayCopy(original);
    assert.equal(display.width, 300);
    assert.equal(display.height, 150);
    assert.equal(await readExifGps(display.data), null);
    const meta = await sharp(display.data).metadata();
    assert.equal(meta.format, "jpeg");
    assert.equal(meta.exif, undefined);
  });

  it("converts PNG to JPEG and rejects broken or oversized images", async () => {
    const png = await createDisplayCopy(await makePng(120, 80));
    assert.equal((await sharp(png.data).metadata()).format, "jpeg");

    const broken = Buffer.concat([(await makeJpeg()).subarray(0, 40)]);
    await assert.rejects(createDisplayCopy(broken), (e: unknown) => e instanceof HttpError && e.code === "IMAGE_INVALID");

    const huge = await sharp({ create: { width: 8001, height: 10, channels: 3, background: "#000" } }).jpeg().toBuffer();
    await assert.rejects(createDisplayCopy(huge), (e: unknown) => e instanceof HttpError && e.code === "IMAGE_DIMENSIONS_TOO_LARGE");
  });

  it("accepts only server-generated storage keys", () => {
    assert.ok(isValidStorageKey("display/123e4567-e89b-42d3-a456-426614174000.jpg"));
    for (const key of ["../etc/passwd", "display/../../x.jpg", "display/abc.jpg", "other/123e4567-e89b-42d3-a456-426614174000.jpg", "/abs/path.jpg"]) {
      assert.equal(isValidStorageKey(key), false, key);
    }
  });
});

import sharp from "sharp";
import { DISPLAY_JPEG_QUALITY, MAX_IMAGE_DIMENSION } from "../../config/reports.js";
import { HttpError } from "../../utils/httpError.js";

export interface DisplayImage {
  /** JPEG bytes without any metadata (no EXIF/GPS), orientation applied. */
  data: Buffer;
  width: number;
  height: number;
}

const invalidImage = (cause?: unknown): HttpError =>
  new HttpError(400, "IMAGE_INVALID", "The photo could not be read. Please choose another image.", { cause });

/**
 * Creates the copy of a photo that users see and the AI service analyses:
 * - rotated according to its EXIF orientation (so AI boxes match what people see),
 * - re-encoded as JPEG, which drops ALL metadata including GPS (sharp keeps none by default),
 * - transparent PNG areas flattened onto white.
 * The original upload (with its EXIF) is stored separately and never served.
 */
export async function createDisplayCopy(original: Buffer): Promise<DisplayImage> {
  let width: number | undefined;
  let height: number | undefined;
  try {
    ({ width, height } = await sharp(original, { failOn: "error" }).metadata());
  } catch (error) {
    throw invalidImage(error);
  }
  if (width === undefined || height === undefined || width < 1 || height < 1) {
    throw invalidImage();
  }
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
    throw new HttpError(
      413,
      "IMAGE_DIMENSIONS_TOO_LARGE",
      `The photo is too large. The longest side may be at most ${MAX_IMAGE_DIMENSION} pixels.`,
    );
  }

  try {
    const { data, info } = await sharp(original, {
      failOn: "error",
      limitInputPixels: MAX_IMAGE_DIMENSION * MAX_IMAGE_DIMENSION,
    })
      .rotate()
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: DISPLAY_JPEG_QUALITY })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch (error) {
    throw invalidImage(error);
  }
}

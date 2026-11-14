import type { AllowedImageType } from "../../config/reports.js";

const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Detects the image type from the file's first bytes ("magic numbers").
 * The file name and the MIME type sent by the client are ignored: both are easy to fake.
 */
export function detectImageType(data: Uint8Array): AllowedImageType | null {
  if (startsWith(data, JPEG_SIGNATURE)) {
    return "image/jpeg";
  }
  if (startsWith(data, PNG_SIGNATURE)) {
    return "image/png";
  }
  return null;
}

function startsWith(data: Uint8Array, signature: readonly number[]): boolean {
  return data.length >= signature.length && signature.every((byte, index) => data[index] === byte);
}

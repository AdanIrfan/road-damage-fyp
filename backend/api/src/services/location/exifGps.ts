import exifr from "exifr";
import { isValidCoordinates, type Coordinates } from "./haversine.js";

/**
 * Reads the GPS position from a photo's EXIF metadata.
 * Must be called on the ORIGINAL upload: the display copy has its metadata removed.
 * Returns null when there is no usable position (missing, unreadable, out of range, or 0,0,
 * which cameras write when they have no fix). Missing metadata is common and is not fraud.
 */
export async function readExifGps(image: Buffer): Promise<Coordinates | null> {
  let gps: unknown;
  try {
    gps = await exifr.gps(image);
  } catch {
    return null;
  }
  if (typeof gps !== "object" || gps === null) {
    return null;
  }
  const { latitude, longitude } = gps as Partial<Record<"latitude" | "longitude", unknown>>;
  if (typeof latitude !== "number" || typeof longitude !== "number") {
    return null;
  }
  const position = { latitude, longitude };
  if (!isValidCoordinates(position) || (latitude === 0 && longitude === 0)) {
    return null;
  }
  return position;
}

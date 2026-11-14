import type { LocationVerificationStatus } from "../../generated/prisma/client.js";
import { haversineMeters, type Coordinates } from "./haversine.js";

export interface LocationCheck {
  status: LocationVerificationStatus;
  /** True when an admin should check the location. Reports are never rejected automatically. */
  needsReview: boolean;
  /** Distance between the EXIF position and the selected location (gallery uploads with EXIF GPS). */
  distanceMeters: number | null;
}

/**
 * Gallery upload: compare the EXIF position of the original photo with the location the
 * citizen picked on the map.
 */
export function verifyGalleryLocation(
  selected: Coordinates,
  exif: Coordinates | null,
  toleranceKm: number,
): LocationCheck {
  if (exif === null) {
    return { status: "NO_METADATA", needsReview: true, distanceMeters: null };
  }
  const distanceMeters = Math.round(haversineMeters(selected, exif) * 10) / 10;
  const verified = distanceMeters <= toleranceKm * 1000;
  return { status: verified ? "VERIFIED" : "MISMATCH", needsReview: !verified, distanceMeters };
}

/**
 * Live camera: the location comes from browser GPS; no EXIF comparison is made (browser camera
 * images have no EXIF GPS). Poor accuracy only flags the report for review.
 */
export function verifyLiveLocation(accuracyMeters: number, thresholdMeters: number): LocationCheck {
  return { status: "BROWSER_GPS", needsReview: accuracyMeters > thresholdMeters, distanceMeters: null };
}

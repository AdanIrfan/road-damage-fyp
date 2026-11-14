import sharp from "sharp";

/** A plain JPEG generated in memory (no metadata). */
export async function makeJpeg(width = 200, height = 100): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 90, g: 90, b: 90 } } })
    .jpeg()
    .toBuffer();
}

export async function makePng(width = 120, height = 80): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: { r: 10, g: 120, b: 200, alpha: 0.5 } } })
    .png()
    .toBuffer();
}

/** A JPEG whose EXIF contains the given GPS position (like a phone photo with location enabled). */
export async function makeJpegWithGps(latitude: number, longitude: number, width = 200, height = 100): Promise<Buffer> {
  const jpeg = await makeJpeg(width, height);
  // Insert the APP1 (EXIF) segment right after the SOI marker (FF D8).
  return Buffer.concat([jpeg.subarray(0, 2), exifGpsSegment(latitude, longitude), jpeg.subarray(2)]);
}

/**
 * Builds a minimal big-endian EXIF APP1 segment: IFD0 with a GPSInfo pointer, and a GPS IFD with
 * latitude/longitude (degrees, minutes, seconds as rationals) and their N/S, E/W references.
 */
function exifGpsSegment(latitude: number, longitude: number): Buffer {
  const IFD0_OFFSET = 8;
  const GPS_IFD_OFFSET = IFD0_OFFSET + 2 + 12 + 4; // 1 entry
  const DATA_OFFSET = GPS_IFD_OFFSET + 2 + 4 * 12 + 4; // 4 entries
  const tiff = Buffer.alloc(DATA_OFFSET + 48);

  tiff.write("MM", 0, "ascii");
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(IFD0_OFFSET, 4);

  let p = IFD0_OFFSET;
  tiff.writeUInt16BE(1, p);
  writeEntry(tiff, p + 2, 0x8825, 4, 1, GPS_IFD_OFFSET); // GPSInfo pointer (LONG)
  tiff.writeUInt32BE(0, p + 14); // no next IFD

  p = GPS_IFD_OFFSET;
  tiff.writeUInt16BE(4, p);
  writeAsciiEntry(tiff, p + 2, 0x0001, latitude >= 0 ? "N" : "S");
  writeEntry(tiff, p + 14, 0x0002, 5, 3, DATA_OFFSET); // GPSLatitude (RATIONAL x3)
  writeAsciiEntry(tiff, p + 26, 0x0003, longitude >= 0 ? "E" : "W");
  writeEntry(tiff, p + 38, 0x0004, 5, 3, DATA_OFFSET + 24); // GPSLongitude
  tiff.writeUInt32BE(0, p + 50);

  writeDms(tiff, DATA_OFFSET, Math.abs(latitude));
  writeDms(tiff, DATA_OFFSET + 24, Math.abs(longitude));

  const payload = Buffer.concat([Buffer.from("Exif\0\0", "binary"), tiff]);
  const header = Buffer.alloc(4);
  header.writeUInt16BE(0xffe1, 0);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

function writeEntry(buf: Buffer, at: number, tag: number, type: number, count: number, value: number): void {
  buf.writeUInt16BE(tag, at);
  buf.writeUInt16BE(type, at + 2);
  buf.writeUInt32BE(count, at + 4);
  buf.writeUInt32BE(value, at + 8);
}

function writeAsciiEntry(buf: Buffer, at: number, tag: number, letter: string): void {
  buf.writeUInt16BE(tag, at);
  buf.writeUInt16BE(2, at + 2); // ASCII
  buf.writeUInt32BE(2, at + 4); // letter + NUL, stored inline
  buf.write(letter, at + 8, "ascii");
}

function writeDms(buf: Buffer, at: number, decimal: number): void {
  const degrees = Math.floor(decimal);
  const minutesFloat = (decimal - degrees) * 60;
  const minutes = Math.floor(minutesFloat);
  const seconds = Math.round((minutesFloat - minutes) * 60 * 1000);
  const parts: [number, number][] = [
    [degrees, 1],
    [minutes, 1],
    [seconds, 1000],
  ];
  parts.forEach(([numerator, denominator], index) => {
    buf.writeUInt32BE(numerator, at + index * 8);
    buf.writeUInt32BE(denominator, at + index * 8 + 4);
  });
}

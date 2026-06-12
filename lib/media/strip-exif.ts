/**
 * Pure JPEG metadata stripper (T11 — D9/D12, outside-voice F8).
 *
 * Field photos carry sensitive EXIF: GPS coordinates of customer properties,
 * timestamps, device ids, and sometimes embedded thumbnails of faces. We
 * strip it server-side as a hard guarantee (client-side stripping can be
 * bypassed). Pure + synchronous so it unit-tests without native deps.
 *
 * Removes APP1 (Exif + XMP) and APP13 (Photoshop/IPTC) segments; keeps APP0
 * (JFIF) and APP2 (ICC color profile) so the image still renders correctly.
 * Non-JPEG input passes through unchanged (PNG/WebP from a canvas re-encode
 * are already metadata-free; the client downscales to JPEG before upload).
 */

// APP1 = 0xE1 (Exif/XMP), APP13 = 0xED (IPTC). Everything else is preserved.
const DROP_MARKERS = new Set<number>([0xe1, 0xed]);

export const isJpeg = (data: Uint8Array): boolean =>
  data.length >= 2 && data[0] === 0xff && data[1] === 0xd8;

export const stripJpegMetadata = (input: Uint8Array): Uint8Array => {
  if (!isJpeg(input)) return input;

  const out: number[] = [0xff, 0xd8]; // SOI
  let i = 2;

  while (i + 1 < input.length) {
    // Re-sync over any fill bytes (0xFF padding before a marker).
    if (input[i] !== 0xff) {
      for (let k = i; k < input.length; k++) out.push(input[k]);
      break;
    }

    const marker = input[i + 1];

    // Start of Scan: the rest is entropy-coded image data — copy verbatim.
    if (marker === 0xda) {
      for (let k = i; k < input.length; k++) out.push(input[k]);
      break;
    }

    // End of Image.
    if (marker === 0xd9) {
      out.push(0xff, 0xd9);
      break;
    }

    // Markers without a length payload (RSTn, SOI, EOI, TEM): copy + advance.
    if (
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd8)
    ) {
      out.push(0xff, marker);
      i += 2;
      continue;
    }

    if (i + 3 >= input.length) {
      for (let k = i; k < input.length; k++) out.push(input[k]);
      break;
    }

    const segLength = (input[i + 2] << 8) | input[i + 3]; // includes length bytes
    const segEnd = i + 2 + segLength;

    if (segEnd > input.length) {
      // Malformed length — copy the remainder and stop rather than overrun.
      for (let k = i; k < input.length; k++) out.push(input[k]);
      break;
    }

    if (!DROP_MARKERS.has(marker)) {
      for (let k = i; k < segEnd; k++) out.push(input[k]);
    }

    i = segEnd;
  }

  return Uint8Array.from(out);
};

/** True when a JPEG still carries an APP1 (Exif/XMP) segment before the scan. */
export const hasExif = (data: Uint8Array): boolean => {
  if (!isJpeg(data)) return false;
  let i = 2;
  while (i + 3 < data.length) {
    if (data[i] !== 0xff) return false;
    const marker = data[i + 1];
    if (marker === 0xda || marker === 0xd9) return false;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2;
      continue;
    }
    if (marker === 0xe1) return true;
    const segLength = (data[i + 2] << 8) | data[i + 3];
    i += 2 + segLength;
  }
  return false;
};

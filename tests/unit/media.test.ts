import { describe, expect, it } from "vitest";

import { hasExif, isJpeg, stripJpegMetadata } from "@/features/media/strip-exif";
import { validateUpload } from "@/features/media/policy";

/** Build a minimal valid-enough JPEG: SOI, optional APP1, APP0, SOS+data, EOI. */
const buildJpeg = (withExif: boolean): Uint8Array => {
  const bytes: number[] = [0xff, 0xd8]; // SOI

  if (withExif) {
    // APP1 (Exif) — length covers the 2 length bytes + payload.
    const exifPayload = [
      0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
      0x47, 0x50, 0x53, 0xaa, 0xbb, 0xcc, // pretend GPS bytes
    ];
    const len = exifPayload.length + 2;
    bytes.push(0xff, 0xe1, (len >> 8) & 0xff, len & 0xff, ...exifPayload);
  }

  // APP0 (JFIF) — must survive.
  const jfif = [0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01];
  bytes.push(0xff, 0xe0, 0x00, jfif.length + 2, ...jfif);

  // SOS + a little scan data, then EOI.
  bytes.push(0xff, 0xda, 0x00, 0x03, 0x01, 0x11, 0x22, 0x33, 0xff, 0xd9);
  return Uint8Array.from(bytes);
};

describe("EXIF stripping (T11 — D9/F8)", () => {
  it("detects a JPEG by its SOI marker", () => {
    expect(isJpeg(buildJpeg(false))).toBe(true);
    expect(isJpeg(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
  });

  it("flags a JPEG that carries an APP1/Exif segment", () => {
    expect(hasExif(buildJpeg(true))).toBe(true);
    expect(hasExif(buildJpeg(false))).toBe(false);
  });

  it("removes the Exif segment (and its GPS bytes)", () => {
    const withExif = buildJpeg(true);
    expect(hasExif(withExif)).toBe(true);

    const stripped = stripJpegMetadata(withExif);
    expect(hasExif(stripped)).toBe(false);

    // The "GPS" payload must be gone.
    const gpsNeedle = [0x47, 0x50, 0x53, 0xaa, 0xbb, 0xcc].join(",");
    expect(Array.from(stripped).join(",")).not.toContain(gpsNeedle);
  });

  it("preserves SOI, the JFIF APP0 segment, and scan data", () => {
    const stripped = stripJpegMetadata(buildJpeg(true));
    expect(stripped[0]).toBe(0xff);
    expect(stripped[1]).toBe(0xd8);
    const joined = Array.from(stripped).join(",");
    expect(joined).toContain([0x4a, 0x46, 0x49, 0x46].join(",")); // JFIF
    expect(joined).toContain([0x01, 0x11, 0x22, 0x33].join(",")); // scan data
    expect(stripped[stripped.length - 2]).toBe(0xff);
    expect(stripped[stripped.length - 1]).toBe(0xd9); // EOI
  });

  it("is idempotent and a no-op on already-clean JPEGs", () => {
    const clean = buildJpeg(false);
    const once = stripJpegMetadata(clean);
    const twice = stripJpegMetadata(once);
    expect(Array.from(twice)).toEqual(Array.from(once));
  });

  it("passes non-JPEG bytes through unchanged", () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(Array.from(stripJpegMetadata(png))).toEqual(Array.from(png));
  });
});

describe("upload policy (T11)", () => {
  it("rejects employees", () => {
    const result = validateUpload("employee", "PHOTO", "image/jpeg", 1000);
    expect(result).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("allows owners and managers to upload photos", () => {
    expect(validateUpload("owner", "PHOTO", "image/jpeg", 1000).ok).toBe(true);
    expect(validateUpload("manager", "PHOTO", "image/png", 1000).ok).toBe(true);
  });

  it("rejects unsupported content types", () => {
    const result = validateUpload("owner", "PHOTO", "application/pdf", 1000);
    expect(result).toMatchObject({ ok: false, code: "unsupported_type" });
  });

  it("normalizes content-type params before matching", () => {
    expect(validateUpload("owner", "PHOTO", "image/jpeg; charset=binary", 1000).ok).toBe(true);
  });

  it("rejects oversized and empty files", () => {
    expect(validateUpload("owner", "PHOTO", "image/jpeg", 99 * 1024 * 1024)).toMatchObject({
      ok: false,
      code: "too_large",
    });
    expect(validateUpload("owner", "PHOTO", "image/jpeg", 0)).toMatchObject({
      ok: false,
      code: "too_large",
    });
  });

  it("applies the right limit per kind", () => {
    // 30MB voice note: under the 25MB? no — over. Video allows 100MB.
    expect(validateUpload("owner", "VOICE", "audio/mpeg", 30 * 1024 * 1024).ok).toBe(false);
    expect(validateUpload("owner", "VIDEO", "video/mp4", 30 * 1024 * 1024).ok).toBe(true);
  });
});

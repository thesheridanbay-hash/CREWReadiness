import type { SessionRole } from "@/lib/auth/session";

/**
 * Upload policy (T11 — D9/F8): per-kind type + size allowlists, pure so the
 * route and tests share one source of truth.
 */

export type MediaKind = "PHOTO" | "VOICE" | "VIDEO";

const MB = 1024 * 1024;

export const MEDIA_LIMITS: Record<
  MediaKind,
  { maxBytes: number; contentTypes: string[] }
> = {
  PHOTO: {
    maxBytes: 12 * MB,
    contentTypes: ["image/jpeg", "image/png", "image/webp"],
  },
  VOICE: {
    maxBytes: 25 * MB,
    contentTypes: ["audio/mpeg", "audio/mp4", "audio/m4a", "audio/wav", "audio/webm"],
  },
  VIDEO: {
    maxBytes: 100 * MB,
    contentTypes: ["video/mp4", "video/quicktime", "video/webm"],
  },
};

/** Only office roles author media→training source material (P5 opens this up). */
export const canUploadMedia = (role: SessionRole): boolean =>
  role === "owner" || role === "manager" || role === "platform";

export type UploadValidation =
  | { ok: true }
  | { ok: false; code: "forbidden" | "unsupported_type" | "too_large"; message: string };

export const validateUpload = (
  role: SessionRole,
  kind: MediaKind,
  contentType: string,
  sizeBytes: number
): UploadValidation => {
  if (!canUploadMedia(role)) {
    return { ok: false, code: "forbidden", message: "Only owners and managers can upload media." };
  }

  const limit = MEDIA_LIMITS[kind];
  const normalizedType = contentType.split(";")[0].trim().toLowerCase();

  if (!limit.contentTypes.includes(normalizedType)) {
    return {
      ok: false,
      code: "unsupported_type",
      message: `${normalizedType || "unknown type"} is not allowed for ${kind.toLowerCase()} uploads.`,
    };
  }

  if (sizeBytes <= 0 || sizeBytes > limit.maxBytes) {
    return {
      ok: false,
      code: "too_large",
      message: `File exceeds the ${Math.round(limit.maxBytes / MB)}MB limit for ${kind.toLowerCase()}.`,
    };
  }

  return { ok: true };
};

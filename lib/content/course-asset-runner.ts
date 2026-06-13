import { put } from "@vercel/blob";
import { randomUUID } from "node:crypto";

import { and, asc, eq, sql } from "drizzle-orm";

import { courseAssets, courses, mediaAssets } from "@/db/schema";
import { generateImage } from "@/lib/ai/gateway";
import type { ImageResult } from "@/lib/ai/types";
import type { ScopedTx } from "@/lib/db/scoped";

/**
 * Shared course-image work (AI Course Builder), used by BOTH the synchronous
 * route (free-tier, client-driven one-at-a-time) and the Inngest pipeline
 * (when a background worker is connected). Keeping it in one place means the
 * two drivers can never drift on how an asset is generated and persisted.
 */

/** Map our stored asset kind to the gateway's style-prime kind. */
export const imageKindFor = (
  kind: "ICON" | "ILLUSTRATION" | "REALISTIC"
): "icon" | "illustration" | "realistic" =>
  kind === "ICON" ? "icon" : kind === "REALISTIC" ? "realistic" : "illustration";

/** Generated art is served through the authed proxy, never hotlinked. */
export const mediaProxyPath = (mediaAssetId: string): string =>
  `/api/media/${mediaAssetId}`;

const toBytes = async (
  result: ImageResult
): Promise<{ bytes: Buffer; contentType: string }> => {
  if (result.b64) {
    return { bytes: Buffer.from(result.b64, "base64"), contentType: result.contentType };
  }
  if (result.url) {
    const response = await fetch(result.url);
    if (!response.ok) {
      throw new Error(`Fetching generated image failed: HTTP ${response.status}`);
    }
    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") ?? result.contentType,
    };
  }
  throw new Error("Image provider returned no bytes.");
};

export type AssetOutcome = { ref: string; kind: string; status: "GENERATED" | "SKIPPED" };

/**
 * The next PENDING asset for a course (icon first, then lesson art by order).
 * Returns null when the queue is drained.
 */
export const nextPendingAssetId = async (
  tx: ScopedTx,
  courseId: number
): Promise<string | null> => {
  const rows = await tx
    .select({ id: courseAssets.id })
    .from(courseAssets)
    .where(and(eq(courseAssets.courseId, courseId), eq(courseAssets.status, "PENDING")))
    .orderBy(asc(courseAssets.order))
    .limit(1);
  return rows[0]?.id ?? null;
};

export const countPendingAssets = async (
  tx: ScopedTx,
  courseId: number
): Promise<number> => {
  const result = await tx.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM course_assets
    WHERE course_id = ${courseId} AND status = 'PENDING'
  `);
  return result.rows[0]?.n ?? 0;
};

/**
 * Generate ONE asset and persist it (image → Blob → media_assets → mark
 * GENERATED; the icon also updates courses.imageSrc). Runs inside the caller's
 * scoped transaction. Idempotent: a row that isn't PENDING is skipped. Throws
 * on provider/storage failure — the caller marks it FAILED in a fresh tx.
 */
export const runCourseAsset = async (
  tx: ScopedTx,
  companyId: string,
  assetId: string,
  jobId?: string
): Promise<AssetOutcome> => {
  const asset = await tx.query.courseAssets.findFirst({
    where: eq(courseAssets.id, assetId),
  });
  if (!asset || asset.status !== "PENDING") {
    return { ref: asset?.ref ?? assetId, kind: asset?.kind ?? "", status: "SKIPPED" };
  }

  const result = await generateImage(
    { tx, companyId, jobId },
    { prompt: asset.prompt, kind: imageKindFor(asset.kind) }
  );
  const { bytes, contentType } = await toBytes(result);

  const blob = await put(`course-assets/${companyId}/${randomUUID()}.png`, bytes, {
    access: "public",
    contentType,
    addRandomSuffix: true,
  });

  const [media] = await tx
    .insert(mediaAssets)
    .values({
      companyId,
      uploadedBy: "ai",
      pathname: blob.url,
      contentType,
      kind: "PHOTO",
      sizeBytes: bytes.byteLength,
    })
    .returning();

  await tx
    .update(courseAssets)
    .set({ status: "GENERATED", mediaAssetId: media.id, error: null, updatedAt: new Date() })
    .where(eq(courseAssets.id, assetId));

  if (asset.kind === "ICON") {
    await tx
      .update(courses)
      .set({ imageSrc: mediaProxyPath(media.id) })
      .where(eq(courses.id, asset.courseId));
  }

  return { ref: asset.ref, kind: asset.kind, status: "GENERATED" };
};

/** Mark a single asset FAILED (own tx — the work tx has rolled back). */
export const markAssetFailed = async (
  tx: ScopedTx,
  assetId: string,
  message: string
): Promise<void> => {
  await tx
    .update(courseAssets)
    .set({ status: "FAILED", error: message.slice(0, 2000), updatedAt: new Date() })
    .where(eq(courseAssets.id, assetId));
};

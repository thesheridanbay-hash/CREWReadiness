import { put } from "@vercel/blob";
import { randomUUID } from "node:crypto";

import { asc, eq } from "drizzle-orm";

import { aiJobs, courseAssets, courses, mediaAssets } from "@/db/schema";
import { generateImage } from "@/lib/ai/gateway";
import type { ImageResult } from "@/lib/ai/types";
import { scopedForJob } from "@/lib/db/scoped";

import { EVENTS, inngest, jobIdFrom } from "../client";
import { markJobRunning, markJobSucceeded, safeDeadLetter } from "../job-helpers";

/**
 * Sequential course-image pipeline (AI Course Builder).
 *
 * The owner's hard requirement: generate images ONE AT A TIME — fire a single
 * request, wait for it, then the next — never a parallel fan-out (that drops
 * or skips results). We honor this two ways:
 *   1. A per-job concurrency cap of 1, so a given course's queue never runs
 *      twice at once.
 *   2. The drain loop awaits each asset's step.run before starting the next,
 *      so exactly one image request is ever in flight.
 *
 * Resumable + idempotent: each asset is its own durable Inngest step (memoized
 * across re-invocations), and every step re-reads the row and no-ops unless it
 * is still PENDING. A single asset failing is marked FAILED and the drain
 * CONTINUES — one bad image never blocks the rest of the course (retryable
 * later). The course ICON leads the queue (order 0) and, once generated,
 * updates courses.imageSrc.
 *
 * Tenant identity always comes from the ai_jobs row (scopedForJob), never the
 * event payload (D20/F2). The courseId rides the job payload (not tenant data).
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
    // Provider returned a URL instead of bytes: pull them so the image lives in
    // our Blob behind the proxy (tenant content, never an external hotlink).
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

type AssetOutcome = { ref: string; status: "GENERATED" | "FAILED" | "SKIPPED" };

/**
 * Process exactly one asset. Self-contained and non-throwing: on any failure it
 * records FAILED (in a fresh transaction, since the work transaction rolls
 * back) and returns, so the caller's drain loop keeps going.
 */
const processOneAsset = async (
  jobId: string,
  assetId: string
): Promise<AssetOutcome> => {
  try {
    return await scopedForJob(jobId, async (tx, companyId) => {
      const asset = await tx.query.courseAssets.findFirst({
        where: eq(courseAssets.id, assetId),
      });
      // Idempotent: only PENDING rows are generated; a retry that finds the row
      // already GENERATED/FAILED simply no-ops.
      if (!asset || asset.status !== "PENDING") {
        return { ref: asset?.ref ?? assetId, status: "SKIPPED" };
      }

      const result = await generateImage(
        { tx, companyId, jobId },
        { prompt: asset.prompt, kind: imageKindFor(asset.kind) }
      );
      const { bytes, contentType } = await toBytes(result);

      const blob = await put(
        `course-assets/${companyId}/${randomUUID()}.png`,
        bytes,
        { access: "public", contentType, addRandomSuffix: true }
      );

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

      // The icon is the course's card image.
      if (asset.kind === "ICON") {
        await tx
          .update(courses)
          .set({ imageSrc: mediaProxyPath(media.id) })
          .where(eq(courses.id, asset.courseId));
      }

      return { ref: asset.ref, status: "GENERATED" };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await scopedForJob(jobId, async (tx) => {
      await tx
        .update(courseAssets)
        .set({ status: "FAILED", error: message.slice(0, 2000), updatedAt: new Date() })
        .where(eq(courseAssets.id, assetId));
    }).catch(() => {
      // Marking FAILED is best-effort; never let the drain loop die here.
    });
    return { ref: assetId, status: "FAILED" };
  }
};

export const generateCourseAssets = inngest.createFunction(
  {
    id: "generate-course-assets",
    retries: 2,
    // One run per job; a course's queue is never drained in parallel.
    concurrency: { limit: 1, key: "event.data.jobId" },
    triggers: [{ event: EVENTS.courseAssetsRequested }],
    onFailure: async ({ event, error }) => {
      await safeDeadLetter(event.data.event?.data, error.message);
    },
  },
  async ({ event, step }) => {
    const jobId = jobIdFrom(event.data);

    await step.run("mark-running", () => markJobRunning(jobId));

    // Stable, ordered worklist (icon at order 0, then lesson art). Captured in
    // its own step so the drain order is fixed across re-invocations.
    const assetIds = await step.run("load-assets", () =>
      scopedForJob(jobId, async (tx) => {
        const job = await tx.query.aiJobs.findFirst({ where: eq(aiJobs.id, jobId) });
        const courseId =
          typeof job?.payload?.courseId === "number" ? job.payload.courseId : null;
        if (courseId === null) throw new Error("Job payload has no courseId.");

        const rows = await tx
          .select({ id: courseAssets.id })
          .from(courseAssets)
          .where(eq(courseAssets.courseId, courseId))
          .orderBy(asc(courseAssets.order));
        return rows.map((r) => r.id);
      })
    );

    // Drain STRICTLY sequentially: await each before the next. Exactly one
    // image request is ever in flight.
    let generated = 0;
    let failed = 0;
    for (const assetId of assetIds) {
      const outcome = await step.run(`asset-${assetId}`, () =>
        processOneAsset(jobId, assetId)
      );
      if (outcome.status === "GENERATED") generated += 1;
      else if (outcome.status === "FAILED") failed += 1;
    }

    await step.run("mark-succeeded", () => markJobSucceeded(jobId));

    return { jobId, total: assetIds.length, generated, failed };
  }
);

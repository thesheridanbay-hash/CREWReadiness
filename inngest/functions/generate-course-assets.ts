import { asc, eq } from "drizzle-orm";

import { aiJobs, courseAssets } from "@/db/schema";
import {
  imageKindFor,
  markAssetFailed,
  mediaProxyPath,
  runCourseAsset,
} from "@/features/courses/course-asset-runner";
import { scopedForJob } from "@/shared/db/scoped";

import { EVENTS, inngest, jobIdFrom } from "../client";
import { markJobRunning, markJobSucceeded, safeDeadLetter } from "../job-helpers";

/**
 * Sequential course-image pipeline (AI Course Builder) — the background-worker
 * driver. The per-asset work itself lives in lib/content/course-asset-runner so
 * the synchronous free-tier route (app/api/course/generate-image) and this
 * pipeline generate + persist assets identically.
 *
 * The owner's hard requirement (one image at a time, never a parallel fan-out)
 * is honored by: a per-job concurrency cap of 1, and a drain loop that awaits
 * each asset's step before the next. Resumable + idempotent: each asset is a
 * durable Inngest step that no-ops unless the row is still PENDING; a single
 * failure is marked FAILED and the drain CONTINUES. Tenant identity comes from
 * the ai_jobs row (scopedForJob), never the event payload (D20/F2).
 */

// Re-exported for the unit test + historical import path.
export { imageKindFor, mediaProxyPath };

type AssetOutcome = { ref: string; status: "GENERATED" | "FAILED" | "SKIPPED" };

const processOneAsset = async (
  jobId: string,
  assetId: string
): Promise<AssetOutcome> => {
  try {
    const outcome = await scopedForJob(jobId, (tx, companyId) =>
      runCourseAsset(tx, companyId, assetId, jobId)
    );
    return {
      ref: outcome.ref,
      status: outcome.status === "SKIPPED" ? "SKIPPED" : "GENERATED",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Work tx rolled back — record FAILED in a fresh tx so the drain continues.
    await scopedForJob(jobId, (tx) => markAssetFailed(tx, assetId, message)).catch(
      () => {}
    );
    return { ref: assetId, status: "FAILED" };
  }
};

export const generateCourseAssets = inngest.createFunction(
  {
    id: "generate-course-assets",
    retries: 2,
    concurrency: { limit: 1, key: "event.data.jobId" },
    triggers: [{ event: EVENTS.courseAssetsRequested }],
    onFailure: async ({ event, error }) => {
      await safeDeadLetter(event.data.event?.data, error.message);
    },
  },
  async ({ event, step }) => {
    const jobId = jobIdFrom(event.data);

    await step.run("mark-running", () => markJobRunning(jobId));

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

import { eq } from "drizzle-orm";

import { aiJobs, mediaAssets } from "@/db/schema";
import { analyzePhoto } from "@/lib/ai/gateway";
import { scopedForJob } from "@/shared/db/scoped";

import { EVENTS, inngest, jobIdFrom } from "../client";
import {
  enqueueDraftForReview,
  markJobRunning,
  markJobSucceeded,
  safeDeadLetter,
} from "../job-helpers";

/**
 * Photo → training pipeline (T6 — D6): field-mistake photos (wrong-way /
 * right-way pairs) become draft lessons. Injection posture applies to the
 * owner note AND any text inside the image (delimited prompts + evals, D19).
 */
export const photoToTraining = inngest.createFunction(
  {
    id: "photo-to-training",
    retries: 2,
    triggers: [{ event: EVENTS.photoRequested }],
    onFailure: async ({ event, error }) => {
      // Must never throw (finding #1): extraction + DLQ are fully guarded.
      await safeDeadLetter(event.data.event?.data, error.message);
    },
  },
  async ({ event, step }) => {
    const jobId = jobIdFrom(event.data);

    await step.run("mark-running", () => markJobRunning(jobId));

    const analysis = await step.run("analyze-photo", () =>
      scopedForJob(jobId, async (tx, companyId) => {
        const job = await tx.query.aiJobs.findFirst({
          where: eq(aiJobs.id, jobId),
        });

        if (!job?.mediaAssetId) throw new Error("Job has no media asset.");

        const media = await tx.query.mediaAssets.findFirst({
          where: eq(mediaAssets.id, job.mediaAssetId),
        });

        if (!media) throw new Error("Media asset not found.");

        const ownerNote =
          typeof job.payload?.ownerNote === "string" ? job.payload.ownerNote : "";

        // TODO(T11): authed media proxy URL; pathname is the Blob reference.
        return analyzePhoto(
          { tx, companyId, jobId },
          { imageUrl: media.pathname, ownerNote }
        );
      })
    );

    await step.run("enqueue-review", () =>
      enqueueDraftForReview(jobId, analysis.draft, null)
    );

    await step.run("mark-succeeded", () => markJobSucceeded(jobId));

    return { jobId, observations: analysis.observations.slice(0, 200) };
  }
);

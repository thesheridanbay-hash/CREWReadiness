import { eq } from "drizzle-orm";

import { aiJobs, mediaAssets } from "@/db/schema";
import { generateLesson, transcribeVoice } from "@/features/ai/gateway";
import { scopedForJob } from "@/shared/db/scoped";

import { EVENTS, inngest, jobIdFrom } from "../client";
import {
  enqueueDraftForReview,
  markJobRunning,
  markJobSucceeded,
  safeDeadLetter,
} from "../job-helpers";

/**
 * Voice → training pipeline (T6 — D6): transcribe the owner's voice note,
 * then draft training from the transcript. Transcription and generation are
 * separate steps so a generation retry never re-transcribes.
 */
export const voiceToTraining = inngest.createFunction(
  {
    id: "voice-to-training",
    retries: 2,
    triggers: [{ event: EVENTS.voiceRequested }],
    onFailure: async ({ event, error }) => {
      // Must never throw (finding #1): extraction + DLQ are fully guarded.
      await safeDeadLetter(event.data.event?.data, error.message);
    },
  },
  async ({ event, step }) => {
    const jobId = jobIdFrom(event.data);

    await step.run("mark-running", () => markJobRunning(jobId));

    const transcript = await step.run("transcribe", () =>
      scopedForJob(jobId, async (tx, companyId) => {
        const job = await tx.query.aiJobs.findFirst({
          where: eq(aiJobs.id, jobId),
        });

        if (!job?.mediaAssetId) throw new Error("Job has no media asset.");

        const media = await tx.query.mediaAssets.findFirst({
          where: eq(mediaAssets.id, job.mediaAssetId),
        });

        if (!media) throw new Error("Media asset not found.");

        // TODO(T11): authed media proxy URL; pathname is the Blob reference.
        return transcribeVoice({ tx, companyId, jobId }, media.pathname);
      })
    );

    const draft = await step.run("generate-draft", () =>
      scopedForJob(jobId, (tx, companyId) =>
        generateLesson({ tx, companyId, jobId }, transcript)
      )
    );

    await step.run("enqueue-review", () =>
      enqueueDraftForReview(jobId, draft, null)
    );

    await step.run("mark-succeeded", () => markJobSucceeded(jobId));

    return { jobId, transcriptChars: transcript.length };
  }
);

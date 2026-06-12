import { eq } from "drizzle-orm";

import { aiJobs } from "@/db/schema";
import { generateLesson } from "@/lib/ai/gateway";
import { scopedForJob } from "@/lib/db/scoped";

import { EVENTS, inngest, jobIdFrom } from "../client";
import {
  enqueueDraftForReview,
  markJobRunning,
  markJobSucceeded,
  safeDeadLetter,
} from "../job-helpers";

/**
 * Text → training pipeline (T6 — D6). Owner pastes SOPs/notes; a draft
 * course lands in the review queue. All side effects inside step.run
 * (re-execution-safe); retries then DLQ + notification on final failure.
 */
export const textToTraining = inngest.createFunction(
  {
    id: "text-to-training",
    retries: 2,
    triggers: [{ event: EVENTS.textRequested }],
    onFailure: async ({ event, error }) => {
      // Must never throw (finding #1): extraction + DLQ are fully guarded.
      await safeDeadLetter(event.data.event?.data, error.message);
    },
  },
  async ({ event, step }) => {
    const jobId = jobIdFrom(event.data);

    await step.run("mark-running", () => markJobRunning(jobId));

    const draft = await step.run("generate-draft", () =>
      scopedForJob(jobId, async (tx, companyId) => {
        const job = await tx.query.aiJobs.findFirst({
          where: eq(aiJobs.id, jobId),
        });

        const sourceText =
          typeof job?.payload?.sourceText === "string"
            ? job.payload.sourceText
            : "";

        if (!sourceText) throw new Error("Job payload has no sourceText.");

        return generateLesson({ tx, companyId, jobId }, sourceText);
      })
    );

    await step.run("enqueue-review", async () => {
      const job = await scopedForJob(jobId, (tx) =>
        tx.query.aiJobs.findFirst({ where: eq(aiJobs.id, jobId) })
      );
      const courseId =
        typeof job?.payload?.courseId === "number" ? job.payload.courseId : null;

      await enqueueDraftForReview(jobId, draft, courseId);
    });

    await step.run("mark-succeeded", () => markJobSucceeded(jobId));

    return { jobId, lessons: draft.lessons.length };
  }
);

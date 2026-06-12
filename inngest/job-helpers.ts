import { eq } from "drizzle-orm";

import { aiJobs, notifications, reviewQueue } from "@/db/schema";
import { scopedForJob } from "@/lib/db/scoped";

import type { CourseDraft, LessonDraft } from "@/lib/ai/types";

/**
 * Shared job-lifecycle helpers (T6 — D6). All run through scopedForJob():
 * the job row anchors tenant identity (D20/F2).
 */

export const markJobRunning = (jobId: string) =>
  scopedForJob(jobId, async (tx) => {
    await tx
      .update(aiJobs)
      .set({ status: "RUNNING", updatedAt: new Date() })
      .where(eq(aiJobs.id, jobId));
  });

export const markJobSucceeded = (jobId: string) =>
  scopedForJob(jobId, async (tx) => {
    await tx
      .update(aiJobs)
      .set({ status: "SUCCEEDED", updatedAt: new Date() })
      .where(eq(aiJobs.id, jobId));
  });

/**
 * Safe onFailure entry point (review finding #1): NOTHING here may throw —
 * Inngest does not retry a failed onFailure, so an exception would silently
 * swallow the dead-letter + notification. Extracts the jobId defensively and
 * logs (never raises) when dead-lettering itself fails.
 */
export const safeDeadLetter = async (
  originalEventData: unknown,
  errorMessage: string
): Promise<void> => {
  try {
    const jobId = (originalEventData as { jobId?: unknown } | undefined)
      ?.jobId;

    if (typeof jobId !== "string" || jobId.length === 0) {
      console.error(
        "safeDeadLetter: event carried no jobId; cannot dead-letter.",
        { errorMessage }
      );
      return;
    }

    await deadLetterJob(jobId, errorMessage);
  } catch (error) {
    console.error("safeDeadLetter: dead-lettering itself failed.", error);
  }
};

/**
 * Final-failure handler (DLQ → notification, D6/PLAN §10): mark DEAD_LETTER
 * and notify the job creator (payload.createdBy when present — display-level
 * routing only; tenant identity still comes from the job row).
 */
export const deadLetterJob = (jobId: string, errorMessage: string) =>
  scopedForJob(jobId, async (tx, companyId) => {
    const job = await tx.query.aiJobs.findFirst({
      where: eq(aiJobs.id, jobId),
    });

    await tx
      .update(aiJobs)
      .set({
        status: "DEAD_LETTER",
        error: errorMessage.slice(0, 2000),
        updatedAt: new Date(),
      })
      .where(eq(aiJobs.id, jobId));

    const createdBy =
      typeof job?.payload?.createdBy === "string"
        ? job.payload.createdBy
        : "platform";

    await tx.insert(notifications).values({
      companyId,
      userId: createdBy,
      type: "ai_job_failed",
      payload: { jobId, kind: job?.kind, error: errorMessage.slice(0, 500) },
    });
  });

/** Drafts NEVER auto-publish (D6): everything lands in the review queue. */
export const enqueueDraftForReview = (
  jobId: string,
  draft: LessonDraft,
  courseId: number | null
) =>
  scopedForJob(jobId, async (tx, companyId) => {
    await tx.insert(reviewQueue).values({
      companyId,
      jobId,
      courseId,
      draft: draft as unknown as Record<string, unknown>,
    });
  });

/**
 * Rich course draft (AI Course Builder) into the review queue. Same D6 rule —
 * owner approval materializes it into a new course (review.ts). courseId is
 * null: approval creates the course, it doesn't target an existing one.
 */
export const enqueueCourseDraftForReview = (jobId: string, draft: CourseDraft) =>
  scopedForJob(jobId, async (tx, companyId) => {
    await tx.insert(reviewQueue).values({
      companyId,
      jobId,
      courseId: null,
      draft: draft as unknown as Record<string, unknown>,
    });
  });

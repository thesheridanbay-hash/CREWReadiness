import { eq } from "drizzle-orm";

import { aiJobs, questionVariants } from "@/db/schema";
import { generateVariants } from "@/features/ai/gateway";
import { scopedForJob } from "@/shared/db/scoped";

import { EVENTS, inngest, jobIdFrom } from "../client";
import { markJobRunning, markJobSucceeded, safeDeadLetter } from "../job-helpers";

const VARIANTS_PER_QUESTION = 3;

/**
 * Variant pre-generation (T6 — D7): on publish, regenerate the retest bank
 * for every question in the published course/version. One step per question
 * so a mid-course retry never regenerates completed questions.
 */
export const variantPregen = inngest.createFunction(
  {
    id: "variant-pregen",
    retries: 2,
    triggers: [{ event: EVENTS.variantsRequested }],
    onFailure: async ({ event, error }) => {
      // Must never throw (finding #1): extraction + DLQ are fully guarded.
      await safeDeadLetter(event.data.event?.data, error.message);
    },
  },
  async ({ event, step }) => {
    const jobId = jobIdFrom(event.data);

    await step.run("mark-running", () => markJobRunning(jobId));

    const targets = await step.run("load-questions", () =>
      scopedForJob(jobId, async (tx) => {
        const job = await tx.query.aiJobs.findFirst({
          where: eq(aiJobs.id, jobId),
        });

        const lessonIds = Array.isArray(job?.payload?.lessonIds)
          ? (job.payload.lessonIds as number[])
          : [];
        const contentVersionId =
          typeof job?.payload?.contentVersionId === "number"
            ? job.payload.contentVersionId
            : null;

        if (lessonIds.length === 0 || contentVersionId === null) {
          throw new Error("Job payload needs lessonIds + contentVersionId.");
        }

        const rows = await tx.query.questions.findMany({
          where: (q, { inArray }) => inArray(q.lessonId, lessonIds),
        });

        return rows.map((q) => ({
          questionId: q.id,
          question: q.question,
          explanation: q.explanation ?? "",
          contentVersionId,
        }));
      })
    );

    for (const target of targets) {
      await step.run(`variants-q${target.questionId}`, () =>
        scopedForJob(jobId, async (tx, companyId) => {
          const drafts = await generateVariants(
            { tx, companyId, jobId },
            {
              question: target.question,
              explanation: target.explanation,
              count: VARIANTS_PER_QUESTION,
            }
          );

          // Replace this question's bank for the published version.
          await tx
            .delete(questionVariants)
            .where(eq(questionVariants.questionId, target.questionId));

          await tx.insert(questionVariants).values(
            drafts.map((draft) => ({
              companyId,
              questionId: target.questionId,
              contentVersionId: target.contentVersionId,
              prompt: draft.prompt,
              options: draft.options,
            }))
          );
        })
      );
    }

    await step.run("mark-succeeded", () => markJobSucceeded(jobId));

    return { jobId, questions: targets.length };
  }
);

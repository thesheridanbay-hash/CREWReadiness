import { eq } from "drizzle-orm";

import { aiJobs } from "@/db/schema";
import {
  assembleCourseDraft,
  lessonSlotsFor,
  sumUsage,
  type LessonSlot,
} from "@/features/ai/course-generation";
import {
  generateCourseSkeleton,
  generateLessonContent,
} from "@/features/ai/gateway";
import { recordUsage } from "@/features/ai/meter";
import type { CourseBrief } from "@/features/ai/prompts";
import type { LessonContent, Usage } from "@/features/ai/types";
import { scopedForJob } from "@/shared/db/scoped";

import { EVENTS, inngest, jobIdFrom } from "../client";
import {
  enqueueCourseDraftForReview,
  markJobRunning,
  markJobSucceeded,
  safeDeadLetter,
} from "../job-helpers";

/**
 * Full-course generation (AI Course Builder — D6), CHUNKED PER STEP.
 *
 * A course is too large to emit in one provider response (it truncates), and on
 * a slow provider (the OpenClaw bridge, ~40s/call) the whole build is too long
 * for one function invocation (Vercel caps each at 300s). So we split it into
 * durable Inngest steps: one SKELETON step (titles), then one step PER LESSON
 * (its body), then meter + enqueue. Each step is a single small call well under
 * the per-invocation cap; Inngest checkpoints each, so the TOTAL has no 300s
 * ceiling and a failed lesson retries just that step. Lessons run SEQUENTIALLY
 * on purpose — the bridge serializes, so parallel steps would contend and time
 * out. The draft lands in the review queue; nothing auto-publishes.
 */
export const generateCourseJob = inngest.createFunction(
  {
    id: "generate-course",
    retries: 2,
    triggers: [{ event: EVENTS.courseRequested }],
    onFailure: async ({ event, error }) => {
      await safeDeadLetter(event.data.event?.data, error.message);
    },
  },
  async ({ event, step }) => {
    const jobId = jobIdFrom(event.data);

    await step.run("mark-running", () => markJobRunning(jobId));

    // Step 1 — skeleton (one small call). Reads the brief from the job row and
    // returns it (+ provider id/threshold) so later steps don't re-read it.
    const sk = await step.run("skeleton", () =>
      scopedForJob(jobId, async (tx, companyId) => {
        const job = await tx.query.aiJobs.findFirst({
          where: eq(aiJobs.id, jobId),
        });
        const payload = (job?.payload ?? {}) as {
          brief?: CourseBrief;
          userBrief?: unknown;
        };
        const brief = (payload.brief ?? {}) as CourseBrief;
        const userBrief =
          typeof payload.userBrief === "string" ? payload.userBrief : "";
        const r = await generateCourseSkeleton(
          { tx, companyId, jobId },
          { brief, userBrief }
        );
        return {
          skeleton: r.skeleton,
          usage: r.usage,
          providerName: r.providerName,
          alertThresholdUsd: r.alertThresholdUsd,
          brief,
        };
      })
    );

    // Steps 2..n — one lesson body per step, SEQUENTIAL. Each is one ~40s call.
    // (`bodies` rebuilds from cached step results on every Inngest replay.)
    const slots = lessonSlotsFor(sk.skeleton);
    const bodies: Array<{ slot: LessonSlot; content: LessonContent; usage: Usage }> =
      [];
    for (const slot of slots) {
      const body = await step.run(
        `lesson-${slot.moduleIndex}-${slot.unitIndex}-${slot.lessonIndex}`,
        () =>
          scopedForJob(jobId, async (tx, companyId) => {
            const r = await generateLessonContent(
              { tx, companyId, jobId },
              {
                brief: sk.brief,
                courseTitle: sk.skeleton.courseTitle,
                moduleTitle: slot.moduleTitle,
                unitTitle: slot.unitTitle,
                lessonTitle: slot.lessonTitle,
                label: `lesson M${slot.moduleIndex + 1}U${slot.unitIndex + 1}L${slot.lessonIndex + 1}`,
              }
            );
            return { content: r.content, usage: r.usage };
          })
      );
      bodies.push({ slot, content: body.content, usage: body.usage });
    }

    // Meter the whole generation as one op (skeleton + every lesson).
    await step.run("meter", () =>
      scopedForJob(jobId, (tx, companyId) =>
        recordUsage(
          { tx, companyId, jobId },
          "generateCourse",
          sk.providerName,
          sumUsage([sk.usage, ...bodies.map((b) => b.usage)]),
          sk.alertThresholdUsd
        )
      )
    );

    // Reassemble (pure) + enqueue the draft for owner review.
    const draft = assembleCourseDraft(sk.skeleton, bodies);
    await step.run("enqueue-review", () =>
      enqueueCourseDraftForReview(jobId, draft)
    );
    await step.run("mark-succeeded", () => markJobSucceeded(jobId));

    return { jobId, modules: draft.modules.length, title: draft.courseTitle };
  }
);

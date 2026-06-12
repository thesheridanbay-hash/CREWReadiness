import { eq } from "drizzle-orm";

import { aiJobs } from "@/db/schema";
import { generateCourse } from "@/lib/ai/gateway";
import type { CourseBrief } from "@/lib/ai/prompts";
import { scopedForJob } from "@/lib/db/scoped";

import { EVENTS, inngest, jobIdFrom } from "../client";
import {
  enqueueCourseDraftForReview,
  markJobRunning,
  markJobSucceeded,
  safeDeadLetter,
} from "../job-helpers";

/**
 * Full-course generation (AI Course Builder — D6). The owner's brief + idea
 * become a rich course draft (modules → units → lessons → questions + image
 * prompts) that lands in the review queue; nothing auto-publishes. Heavy work
 * (up to ~3 min) runs here, not in a request, so the Vercel free tier holds.
 * Retries then DLQ + notify on final failure.
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

    const draft = await step.run("generate-draft", () =>
      scopedForJob(jobId, async (tx, companyId) => {
        const job = await tx.query.aiJobs.findFirst({ where: eq(aiJobs.id, jobId) });

        const payload = (job?.payload ?? {}) as {
          brief?: CourseBrief;
          userBrief?: unknown;
        };
        const brief = (payload.brief ?? {}) as CourseBrief;
        const userBrief =
          typeof payload.userBrief === "string" ? payload.userBrief : "";

        return generateCourse({ tx, companyId, jobId }, { brief, userBrief });
      })
    );

    await step.run("enqueue-review", () =>
      enqueueCourseDraftForReview(jobId, draft)
    );

    await step.run("mark-succeeded", () => markJobSucceeded(jobId));

    return { jobId, modules: draft.modules.length, title: draft.courseTitle };
  }
);

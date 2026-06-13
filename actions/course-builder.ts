"use server";

import { aiJobs } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { courseBuilderInputSchema } from "@/lib/content/course-builder-schema";
import { scoped } from "@/lib/db/scoped";
import { AppActionError, fromZod, guard, ok, type Result } from "@/shared/errors";

import { EVENTS, inngest } from "@/inngest/client";

/**
 * Kick off AI Course Builder generation (D6). Heavy work runs in the
 * generate-course Inngest job (it can take minutes); this action just records
 * the PENDING ai_jobs row and fires the event. The resulting draft lands in
 * the review queue for owner approval — never auto-published.
 */

const requireOwner = async () => {
  const auth = await getSession();
  if (!auth) throw new AppActionError("unauthorized", "Sign in to continue.");
  if (auth.role === "employee") {
    throw new AppActionError(
      "forbidden",
      "Only owners and managers can build courses."
    );
  }
  return auth;
};

export const requestCourseGeneration = async (
  input: unknown
): Promise<Result<{ jobId: string }>> =>
  guard<{ jobId: string }>(async () => {
    const parsed = courseBuilderInputSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const auth = await requireOwner();
    const { userBrief, ...brief } = parsed.data;

    const jobId = await scoped<string>(auth, async (tx) => {
      const [job] = await tx
        .insert(aiJobs)
        .values({
          companyId: auth.companyId,
          kind: "GENERATE_COURSE",
          // brief = the structured params (trusted); userBrief = the free-text
          // idea (sandwiched as DATA in the prompt). createdBy is display-only.
          payload: { brief, userBrief: userBrief ?? "", createdBy: auth.userId },
        })
        .returning();
      return job.id;
    });

    // Fire OUTSIDE the transaction; the job stays PENDING for retry if Inngest
    // isn't wired or the send fails.
    if (process.env.INNGEST_EVENT_KEY) {
      try {
        await inngest.send({
          name: EVENTS.courseRequested,
          data: { jobId },
        });
      } catch {
        // Stays PENDING.
      }
    }

    return ok({ jobId });
  });

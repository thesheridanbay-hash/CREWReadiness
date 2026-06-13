import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { aiJobs, reviewQueue } from "@/db/schema";
import { generateCourse } from "@/lib/ai/gateway";
import { getSession } from "@/lib/auth/session";
import {
  courseBuilderInputSchema,
  type CourseBuilderInput,
} from "@/lib/content/course-builder-schema";
import { scoped } from "@/lib/db/scoped";

/**
 * Synchronous AI course generation (AI Course Builder).
 *
 * The provider (OpenClaw) takes ~2 minutes; we run it here under Vercel Fluid
 * Compute's 300s cap so generation works with no background worker. The draft
 * lands in the review queue for owner approval (D6).
 *
 * Resilience (bugfix): every attempt is recorded as a GENERATE_COURSE ai_job,
 * committed BEFORE generation in its own transaction — so a timeout/validation
 * failure (which rolls back the draft insert) still leaves a FAILED row with
 * the error, visible + retryable from /studio/review. Pass { retryJobId } to
 * re-run a previous attempt with its saved inputs.
 */
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const auth = await getSession();
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (auth.role === "employee") {
    return NextResponse.json(
      { error: "forbidden", message: "Only owners and managers can build courses." },
      { status: 403 }
    );
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    input = {};
  }

  const retryJobId =
    typeof (input as { retryJobId?: unknown })?.retryJobId === "string"
      ? (input as { retryJobId: string }).retryJobId
      : null;

  let parsedInput: CourseBuilderInput;
  let jobId: string;

  if (retryJobId) {
    // Re-run a prior attempt from its saved inputs; reuse the same job row.
    const loaded = await scoped(auth, async (tx) => {
      const job = await tx.query.aiJobs.findFirst({
        where: and(eq(aiJobs.id, retryJobId), eq(aiJobs.kind, "GENERATE_COURSE")),
      });
      if (!job) return null;
      const reparsed = courseBuilderInputSchema.safeParse(job.payload);
      if (!reparsed.success) return null;
      await tx
        .update(aiJobs)
        .set({ status: "RUNNING", error: null, updatedAt: new Date() })
        .where(eq(aiJobs.id, job.id));
      return { input: reparsed.data, jobId: job.id };
    });
    if (!loaded) {
      return NextResponse.json(
        { error: "not_found", message: "That generation couldn't be found to retry." },
        { status: 404 }
      );
    }
    parsedInput = loaded.input;
    jobId = loaded.jobId;
  } else {
    const parsed = courseBuilderInputSchema.safeParse(input);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation", message: parsed.error.issues[0]?.message ?? "Invalid input." },
        { status: 400 }
      );
    }
    parsedInput = parsed.data;
    // Commit the attempt row FIRST (own tx) so it survives a generation failure.
    jobId = await scoped(auth, async (tx) => {
      const [job] = await tx
        .insert(aiJobs)
        .values({
          companyId: auth.companyId,
          kind: "GENERATE_COURSE",
          status: "RUNNING",
          payload: { ...parsedInput, createdBy: auth.userId },
        })
        .returning();
      return job.id;
    });
  }

  const { userBrief, ...brief } = parsedInput;

  try {
    const result = await scoped(auth, async (tx) => {
      const draft = await generateCourse(
        { tx, companyId: auth.companyId, jobId },
        { brief, userBrief: userBrief ?? "" }
      );
      const [row] = await tx
        .insert(reviewQueue)
        .values({
          companyId: auth.companyId,
          jobId,
          courseId: null,
          draft: draft as unknown as Record<string, unknown>,
        })
        .returning();
      await tx
        .update(aiJobs)
        .set({ status: "SUCCEEDED", updatedAt: new Date() })
        .where(eq(aiJobs.id, jobId));
      return {
        reviewItemId: row.id,
        title: draft.courseTitle,
        modules: draft.modules.length,
      };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Course generation failed.";
    // Mark the attempt FAILED (own tx) so it shows in the queue with the error.
    await scoped(auth, (tx) =>
      tx
        .update(aiJobs)
        .set({ status: "FAILED", error: message.slice(0, 2000), updatedAt: new Date() })
        .where(eq(aiJobs.id, jobId))
    ).catch(() => {});
    return NextResponse.json(
      { error: "generation_failed", message, jobId },
      { status: 502 }
    );
  }
}

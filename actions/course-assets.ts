"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { aiJobs, courses } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { scoped, type ScopedTx } from "@/lib/db/scoped";
import { AppActionError, err, fromZod, guard, ok, type Result } from "@/lib/errors";

import { EVENTS, inngest } from "@/inngest/client";

/**
 * Kick off (and report on) the sequential course-image pipeline (AI Course
 * Builder). The owner triggers generation after a course is materialized; the
 * Inngest function drains course_assets one at a time. Tenant identity rides
 * the ai_jobs row, never the event payload (D20/F2).
 */

const requireOwner = async () => {
  const auth = await getSession();
  if (!auth) throw new AppActionError("unauthorized", "Sign in to continue.");
  if (auth.role === "employee") {
    throw new AppActionError(
      "forbidden",
      "Only owners and managers can generate course images."
    );
  }
  return auth;
};

const courseIdSchema = z.object({ courseId: z.number().int().positive() });

const countPending = async (tx: ScopedTx, courseId: number): Promise<number> => {
  const result = await tx.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM course_assets
    WHERE course_id = ${courseId} AND status = 'PENDING'
  `);
  return result.rows[0]?.n ?? 0;
};

export const startCourseAssetGeneration = async (
  input: unknown
): Promise<Result<{ jobId: string; pending: number; reused: boolean }>> =>
  guard<{ jobId: string; pending: number; reused: boolean }>(async () => {
    const parsed = courseIdSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const auth = await requireOwner();
    const { courseId } = parsed.data;

    const outcome = await scoped<
      Result<{ jobId: string; pending: number; reused: boolean }>
    >(auth, async (tx) => {
      const course = await tx.query.courses.findFirst({
        where: eq(courses.id, courseId),
      });
      if (!course) throw new AppActionError("not_found", "Course not found.");

      const pending = await countPending(tx, courseId);
      if (pending === 0) {
        return err("conflict", "This course has no images waiting to generate.");
      }

      // Idempotent: if a queue is already in flight for this course, reuse it
      // rather than spawning a second (which would race the same rows).
      const existing = await tx.query.aiJobs.findFirst({
        where: and(
          eq(aiJobs.kind, "GENERATE_COURSE_ASSETS"),
          inArray(aiJobs.status, ["PENDING", "RUNNING"]),
          sql`${aiJobs.payload}->>'courseId' = ${String(courseId)}`
        ),
      });
      if (existing) {
        return ok({ jobId: existing.id, pending, reused: true });
      }

      const [job] = await tx
        .insert(aiJobs)
        .values({
          companyId: auth.companyId,
          kind: "GENERATE_COURSE_ASSETS",
          payload: { courseId, createdBy: auth.userId },
        })
        .returning();

      return ok({ jobId: job.id, pending, reused: false });
    });

    if (!outcome.ok) return outcome;

    // Fire the event OUTSIDE the transaction. If it fails (or Inngest isn't
    // wired yet) the job stays PENDING and can be re-triggered — never block.
    if (!outcome.data.reused && process.env.INNGEST_EVENT_KEY) {
      try {
        await inngest.send({
          name: EVENTS.courseAssetsRequested,
          data: { jobId: outcome.data.jobId },
        });
      } catch {
        // Stays PENDING for retry.
      }
    }

    revalidatePath(`/studio/${courseId}`);
    return outcome;
  });

export type CourseAssetStatus = {
  total: number;
  pending: number;
  generated: number;
  failed: number;
};

export const getCourseAssetStatus = async (
  input: unknown
): Promise<Result<CourseAssetStatus>> =>
  guard<CourseAssetStatus>(async () => {
    const parsed = courseIdSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const auth = await requireOwner();

    return scoped<Result<CourseAssetStatus>>(auth, async (tx) => {
      const result = await tx.execute<{
        total: number;
        pending: number;
        generated: number;
        failed: number;
      }>(sql`
        SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE status = 'PENDING')::int AS pending,
          count(*) FILTER (WHERE status = 'GENERATED')::int AS generated,
          count(*) FILTER (WHERE status = 'FAILED')::int AS failed
        FROM course_assets
        WHERE course_id = ${parsed.data.courseId}
      `);
      const row = result.rows[0] ?? { total: 0, pending: 0, generated: 0, failed: 0 };
      return ok(row);
    });
  });

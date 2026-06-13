"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { aiJobs, courses } from "@/db/schema";
import { getSession } from "@/features/auth/session";
import { scoped, type ScopedTx } from "@/shared/db/scoped";
import { AppActionError, err, fromZod, guard, ok, type Result } from "@/shared/errors";

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

/**
 * Re-queue ONE asset for (re)generation, optionally with a refined prompt — the
 * feedback-driven "fix this image" path. Keeps the existing media so the editor
 * still shows the old version until the new one lands. The owner then triggers
 * generation (Generate media, or an immediate single-asset run).
 */
const requeueSchema = z.object({
  assetId: z.string().uuid(),
  prompt: z.string().trim().max(4000).optional(),
});

export const requeueAsset = async (
  input: unknown
): Promise<Result<{ courseId: number }>> =>
  guard<{ courseId: number }>(async () => {
    const parsed = requeueSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const auth = await requireOwner();

    return scoped<Result<{ courseId: number }>>(auth, async (tx) => {
      const result = await tx.execute<{ course_id: number }>(sql`
        UPDATE course_assets
        SET status = 'PENDING', error = NULL,
            prompt = COALESCE(${parsed.data.prompt ?? null}::text, prompt),
            updated_at = now()
        WHERE id = ${parsed.data.assetId}
        RETURNING course_id
      `);
      const row = result.rows[0];
      if (!row) throw new AppActionError("not_found", "Asset not found.");
      revalidatePath(`/studio/${row.course_id}`);
      return ok({ courseId: row.course_id });
    });
  });

/**
 * Attach an uploaded media asset to a course asset (manual replacement). The
 * UPDATE…FROM join only matches when BOTH rows are visible under the tenant's
 * RLS context, so a cross-company attach is impossible. ICON also updates the
 * course card image.
 */
const setMediaSchema = z.object({
  assetId: z.string().uuid(),
  mediaAssetId: z.string().uuid(),
});

export const setAssetMedia = async (
  input: unknown
): Promise<Result<{ courseId: number }>> =>
  guard<{ courseId: number }>(async () => {
    const parsed = setMediaSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const auth = await requireOwner();

    return scoped<Result<{ courseId: number }>>(auth, async (tx) => {
      const result = await tx.execute<{ course_id: number; kind: string }>(sql`
        UPDATE course_assets ca
        SET status = 'GENERATED', media_asset_id = ${parsed.data.mediaAssetId},
            error = NULL, updated_at = now()
        FROM media_assets m
        WHERE ca.id = ${parsed.data.assetId} AND m.id = ${parsed.data.mediaAssetId}
        RETURNING ca.course_id, ca.kind
      `);
      const row = result.rows[0];
      if (!row) throw new AppActionError("not_found", "Asset or upload not found.");

      if (row.kind === "ICON") {
        await tx.execute(
          sql`UPDATE courses SET image_src = ${`/api/media/${parsed.data.mediaAssetId}`} WHERE id = ${row.course_id}`
        );
      }
      revalidatePath(`/studio/${row.course_id}`);
      return ok({ courseId: row.course_id });
    });
  });

/**
 * Reset FAILED assets back to PENDING so the owner can retry them (the
 * synchronous image loop only picks PENDING). Returns how many were reset.
 */
export const resetFailedAssets = async (
  input: unknown
): Promise<Result<{ reset: number }>> =>
  guard<{ reset: number }>(async () => {
    const parsed = courseIdSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const auth = await requireOwner();

    return scoped<Result<{ reset: number }>>(auth, async (tx) => {
      const result = await tx.execute<{ id: string }>(sql`
        UPDATE course_assets SET status = 'PENDING', error = NULL, updated_at = now()
        WHERE course_id = ${parsed.data.courseId} AND status = 'FAILED'
        RETURNING id
      `);
      revalidatePath(`/studio/${parsed.data.courseId}`);
      return ok({ reset: result.rows.length });
    });
  });

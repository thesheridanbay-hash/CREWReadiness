"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  courses,
  lessons,
  modules,
  questionOptions,
  questions,
  reviewQueue,
  units,
} from "@/db/schema";
import { AppActionError, fromZod, guard, ok, type Result } from "@/shared/errors";
import { getSession } from "@/features/auth/session";
import { scoped, type ScopedTx } from "@/shared/db/scoped";
import { classifyDraft } from "@/features/courses/draft-kind";
import { materializeCourseDraft } from "@/features/courses/materialize-course";

/**
 * Review queue actions (D6). AI drafts NEVER auto-publish — an owner approves
 * (materializing the draft into the course tree) or rejects. Approval is the
 * only path content reaches learners.
 */

const idSchema = z.object({ id: z.number().int().positive() });

const requireOwner = async () => {
  const auth = await getSession();
  if (!auth) throw new AppActionError("unauthorized", "Sign in to continue.");
  if (auth.role === "employee") {
    throw new AppActionError("forbidden", "Only owners and managers can review content.");
  }
  return auth;
};

const nextOrder = async (
  tx: ScopedTx,
  table: typeof modules | typeof units | typeof lessons | typeof questions,
  column: string,
  parentId: number
): Promise<number> => {
  const result = await tx.execute<{ next: number }>(sql`
    SELECT COALESCE(MAX("order"), 0) + 1 AS next
    FROM ${table} WHERE ${sql.raw(column)} = ${parentId}
  `);
  return result.rows[0]?.next ?? 1;
};

/** Ensure a destination "AI Imports" module + unit exists; return the unit id. */
const ensureImportUnit = async (
  tx: ScopedTx,
  companyId: string,
  courseId: number
): Promise<number> => {
  const existing = await tx.execute<{ unit_id: number }>(sql`
    SELECT u.id AS unit_id FROM units u
    JOIN modules m ON m.id = u.module_id
    WHERE m.course_id = ${courseId} AND m.title = 'AI Imports'
    ORDER BY u."order" LIMIT 1
  `);
  if (existing.rows[0]) return existing.rows[0].unit_id;

  const [module] = await tx
    .insert(modules)
    .values({
      companyId,
      courseId,
      title: "AI Imports",
      description: "Approved AI-drafted training.",
      order: await nextOrder(tx, modules, "course_id", courseId),
    })
    .returning();

  const [unit] = await tx
    .insert(units)
    .values({
      companyId,
      moduleId: module.id,
      title: "Imported lessons",
      order: 1,
    })
    .returning();

  return unit.id;
};

export const approveReviewItem = async (input: unknown): Promise<Result<null>> =>
  guard<null>(async () => {
    const parsed = idSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const auth = await requireOwner();

    return scoped<Result<null>>(auth, async (tx) => {
      const item = await tx.query.reviewQueue.findFirst({
        where: eq(reviewQueue.id, parsed.data.id),
      });
      if (!item) throw new AppActionError("not_found", "Review item not found.");
      if (item.status !== "PENDING") {
        throw new AppActionError("conflict", "This item was already reviewed.");
      }

      const classified = classifyDraft(item.draft);
      if (classified.kind === "unknown") {
        throw new AppActionError("conflict", "This draft is malformed and can't be approved.");
      }

      // Course draft (AI Course Builder): materialize a brand-new course tree
      // with its PENDING image queue. Image generation is a separate, explicit
      // owner step (Generate images) — approval never spends on images.
      if (classified.kind === "course") {
        const result = await materializeCourseDraft(tx, auth.companyId, classified.course);

        await tx
          .update(reviewQueue)
          .set({ status: "APPROVED", reviewedBy: auth.userId, reviewedAt: new Date() })
          .where(eq(reviewQueue.id, item.id));

        revalidatePath("/studio/review");
        revalidatePath(`/studio/${result.courseId}`);
        revalidatePath("/learn");
        return ok(null);
      }

      // Lesson draft (text/voice/photo pipelines): append into an "AI Imports"
      // unit on a destination course (the draft's, else the first course).
      const draft = { data: classified.lesson };
      let courseId = item.courseId;
      if (!courseId) {
        const firstCourse = await tx.query.courses.findFirst({
          where: eq(courses.companyId, auth.companyId),
        });
        if (!firstCourse) {
          throw new AppActionError("conflict", "Create a course before approving drafts.");
        }
        courseId = firstCourse.id;
      }

      const unitId = await ensureImportUnit(tx, auth.companyId, courseId);

      // Materialize the draft's lessons + questions + options.
      for (const draftLesson of draft.data.lessons) {
        const [lesson] = await tx
          .insert(lessons)
          .values({
            companyId: auth.companyId,
            unitId,
            title: draftLesson.title,
            order: await nextOrder(tx, lessons, "unit_id", unitId),
          })
          .returning();

        let order = 1;
        for (const draftQuestion of draftLesson.questions) {
          const [question] = await tx
            .insert(questions)
            .values({
              companyId: auth.companyId,
              lessonId: lesson.id,
              type: "SELECT",
              question: draftQuestion.question,
              explanation: draftQuestion.explanation,
              order: order++,
            })
            .returning();
          await tx.insert(questionOptions).values(
            draftQuestion.options.map((option) => ({
              companyId: auth.companyId,
              questionId: question.id,
              text: option.text,
              correct: option.correct,
            }))
          );
        }
      }

      await tx
        .update(reviewQueue)
        .set({ status: "APPROVED", reviewedBy: auth.userId, reviewedAt: new Date() })
        .where(eq(reviewQueue.id, item.id));

      // Materialized as draft content; the owner publishes the course to bump
      // the active version and push it to learners (Studio → Publish).
      revalidatePath("/studio/review");
      revalidatePath(`/studio/${courseId}`);
      return ok(null);
    });
  });

export const rejectReviewItem = async (input: unknown): Promise<Result<null>> =>
  guard<null>(async () => {
    const parsed = idSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const auth = await requireOwner();

    return scoped<Result<null>>(auth, async (tx) => {
      const item = await tx.query.reviewQueue.findFirst({
        where: eq(reviewQueue.id, parsed.data.id),
      });
      if (!item) throw new AppActionError("not_found", "Review item not found.");

      await tx
        .update(reviewQueue)
        .set({ status: "REJECTED", reviewedBy: auth.userId, reviewedAt: new Date() })
        .where(eq(reviewQueue.id, item.id));

      revalidatePath("/studio/review");
      return ok(null);
    });
  });

"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  aiJobs,
  contentVersions,
  courses,
  lessons,
  modules,
  questionOptions,
  questions,
  units,
} from "@/db/schema";
import { improveText } from "@/features/ai/gateway";
import type { ImproveFieldKind } from "@/features/ai/prompts";
import { EVENTS, inngest } from "@/inngest/client";
import { scoped } from "@/shared/db/scoped";
import { err, fromZod, guard, ok, type Result } from "@/shared/errors";
import {
  courseCreateSchema,
  courseUpdateSchema,
  idSchema,
  lessonCreateSchema,
  moduleCreateSchema,
  publishSchema,
  questionCreateSchema,
  questionUpdateSchema,
  unitCreateSchema,
} from "@/features/courses/schemas";
import { nextOrder, requireAuthor } from "./content-helpers";

/**
 * Owner content studio actions (T10 — D16). Hand-written per hierarchy level,
 * all envelope-wrapped, all scoped (RLS-enforced), all gated to office roles.
 * Display order is computed server-side. Publishing bumps the content version
 * and enqueues variant regeneration (D7) — guarded so it never blocks publish.
 */

/* ───────────────────────── Course ───────────────────────── */

export const createCourse = async (
  input: unknown
): Promise<Result<{ id: number }>> =>
  guard<{ id: number }>(async () => {
    const parsed = courseCreateSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const auth = await requireAuthor();

    return scoped<Result<{ id: number }>>(auth, async (tx) => {
      const [course] = await tx
        .insert(courses)
        .values({
          companyId: auth.companyId,
          title: parsed.data.title,
          imageSrc: parsed.data.imageSrc || "/mascot.svg",
        })
        .returning();
      revalidatePath("/studio");
      return ok({ id: course.id });
    });
  });

export const updateCourse = async (input: unknown): Promise<Result<null>> =>
  guard<null>(async () => {
    const parsed = courseUpdateSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const auth = await requireAuthor();

    return scoped<Result<null>>(auth, async (tx) => {
      await tx
        .update(courses)
        .set({ title: parsed.data.title, imageSrc: parsed.data.imageSrc || "/mascot.svg" })
        .where(eq(courses.id, parsed.data.courseId));
      revalidatePath(`/studio/${parsed.data.courseId}`);
      revalidatePath("/studio");
      return ok(null);
    });
  });

/* ───────────────── Course lifecycle: archive / restore / delete ───────────────── */

const courseIdSchema = z.object({ courseId: z.number().int().positive() });

/** Soft-delete: hide from studio/learner lists + assignments, restorable. */
export const archiveCourse = async (input: unknown): Promise<Result<null>> =>
  guard<null>(async () => {
    const parsed = courseIdSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const auth = await requireAuthor();

    return scoped<Result<null>>(auth, async (tx) => {
      const [row] = await tx
        .update(courses)
        .set({ archivedAt: new Date() })
        .where(eq(courses.id, parsed.data.courseId))
        .returning({ id: courses.id });
      if (!row) return err("not_found", "Course not found.");
      revalidatePath("/studio", "layout");
      revalidatePath("/courses");
      revalidatePath("/learn");
      return ok(null);
    });
  });

/** Bring an archived course back to active. */
export const restoreCourse = async (input: unknown): Promise<Result<null>> =>
  guard<null>(async () => {
    const parsed = courseIdSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const auth = await requireAuthor();

    return scoped<Result<null>>(auth, async (tx) => {
      const [row] = await tx
        .update(courses)
        .set({ archivedAt: null })
        .where(eq(courses.id, parsed.data.courseId))
        .returning({ id: courses.id });
      if (!row) return err("not_found", "Course not found.");
      revalidatePath("/studio", "layout");
      revalidatePath("/courses");
      return ok(null);
    });
  });

/**
 * Permanently delete a course (cascades to modules/units/lessons/questions/
 * options/assets/assignments/versions; nulls user_progress + marketplace refs).
 * Only allowed once the course is ARCHIVED — archive-first guards against
 * accidental loss. Marketplace listings keep their frozen snapshot.
 */
export const deleteCourse = async (input: unknown): Promise<Result<null>> =>
  guard<null>(async () => {
    const parsed = courseIdSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const auth = await requireAuthor();

    return scoped<Result<null>>(auth, async (tx) => {
      const course = await tx.query.courses.findFirst({
        where: eq(courses.id, parsed.data.courseId),
      });
      if (!course) return err("not_found", "Course not found.");
      if (!course.archivedAt) {
        return err("conflict", "Archive the course first, then delete it.");
      }
      await tx.delete(courses).where(eq(courses.id, parsed.data.courseId));
      revalidatePath("/studio", "layout");
      revalidatePath("/courses");
      revalidatePath("/learn");
      return ok(null);
    });
  });

/* ───────────────────────── Module / Unit / Lesson ───────────────────────── */

export const createModule = async (input: unknown): Promise<Result<{ id: number }>> =>
  guard<{ id: number }>(async () => {
    const parsed = moduleCreateSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const auth = await requireAuthor();

    return scoped<Result<{ id: number }>>(auth, async (tx) => {
      const course = await tx.query.courses.findFirst({
        where: eq(courses.id, parsed.data.courseId),
      });
      if (!course) return err("not_found", "Course not found.");

      const [row] = await tx
        .insert(modules)
        .values({
          companyId: auth.companyId,
          courseId: parsed.data.courseId,
          title: parsed.data.title,
          description: parsed.data.description ?? "",
          order: await nextOrder(tx, modules, "course_id", parsed.data.courseId),
        })
        .returning();
      revalidatePath(`/studio/${parsed.data.courseId}`);
      return ok({ id: row.id });
    });
  });

export const createUnit = async (input: unknown): Promise<Result<{ id: number }>> =>
  guard<{ id: number }>(async () => {
    const parsed = unitCreateSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const auth = await requireAuthor();

    return scoped<Result<{ id: number }>>(auth, async (tx) => {
      const parent = await tx.query.modules.findFirst({
        where: eq(modules.id, parsed.data.moduleId),
      });
      if (!parent) return err("not_found", "Module not found.");

      const [row] = await tx
        .insert(units)
        .values({
          companyId: auth.companyId,
          moduleId: parsed.data.moduleId,
          title: parsed.data.title,
          description: parsed.data.description ?? "",
          order: await nextOrder(tx, units, "module_id", parsed.data.moduleId),
        })
        .returning();
      revalidatePath(`/studio/${parent.courseId}`);
      return ok({ id: row.id });
    });
  });

export const createLesson = async (input: unknown): Promise<Result<{ id: number }>> =>
  guard<{ id: number }>(async () => {
    const parsed = lessonCreateSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const auth = await requireAuthor();

    return scoped<Result<{ id: number }>>(auth, async (tx) => {
      const parent = await tx.query.units.findFirst({
        where: eq(units.id, parsed.data.unitId),
        with: { module: true },
      });
      if (!parent) return err("not_found", "Unit not found.");

      const [row] = await tx
        .insert(lessons)
        .values({
          companyId: auth.companyId,
          unitId: parsed.data.unitId,
          title: parsed.data.title,
          order: await nextOrder(tx, lessons, "unit_id", parsed.data.unitId),
        })
        .returning();
      revalidatePath(`/studio/${parent.module.courseId}`);
      return ok({ id: row.id });
    });
  });

/* ───────────────── Lesson edit + AI-magic per-field ───────────────── */

const updateLessonSchema = z.object({
  lessonId: z.number().int().positive(),
  title: z.string().trim().min(1).max(200).optional(),
  teachingText: z.string().max(6000).nullable().optional(),
});

/** Manual lesson edit: title and/or teaching text (markdown). */
export const updateLesson = async (input: unknown): Promise<Result<null>> =>
  guard<null>(async () => {
    const parsed = updateLessonSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const auth = await requireAuthor();

    return scoped<Result<null>>(auth, async (tx) => {
      const set: Partial<{ title: string; teachingText: string | null }> = {};
      if (parsed.data.title !== undefined) set.title = parsed.data.title;
      if (parsed.data.teachingText !== undefined)
        set.teachingText = parsed.data.teachingText;
      if (Object.keys(set).length === 0) return ok(null);

      const [row] = await tx
        .update(lessons)
        .set(set)
        .where(eq(lessons.id, parsed.data.lessonId))
        .returning({ id: lessons.id });
      if (!row) return err("not_found", "Lesson not found.");
      revalidatePath("/studio", "layout");
      revalidatePath("/learn");
      return ok(null);
    });
  });

const improveFieldSchema = z.object({
  field: z.enum([
    "lessonTeaching",
    "lessonTitle",
    "questionPrompt",
    "explanation",
    "option",
  ]),
  id: z.number().int().positive(),
  instruction: z.string().trim().max(1000).optional(),
});

/**
 * AI-magic: rewrite/format ONE field in place. Loads the current value from the
 * DB (trusted, RLS-scoped), runs the text model (optionally with the owner's
 * instruction), persists the result, and returns it. Mirrors the image
 * regenerate-with-prompt flow for text.
 */
export const improveField = async (
  input: unknown
): Promise<Result<{ text: string }>> =>
  guard<{ text: string }>(async () => {
    const parsed = improveFieldSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const auth = await requireAuthor();
    const { field, id, instruction } = parsed.data;

    return scoped<Result<{ text: string }>>(auth, async (tx) => {
      let current = "";
      if (field === "lessonTeaching" || field === "lessonTitle") {
        const lesson = await tx.query.lessons.findFirst({
          where: eq(lessons.id, id),
        });
        if (!lesson) return err("not_found", "Lesson not found.");
        current = field === "lessonTitle" ? lesson.title : lesson.teachingText ?? "";
      } else if (field === "questionPrompt" || field === "explanation") {
        const question = await tx.query.questions.findFirst({
          where: eq(questions.id, id),
        });
        if (!question) return err("not_found", "Question not found.");
        current =
          field === "explanation" ? question.explanation ?? "" : question.question;
      } else {
        const option = await tx.query.questionOptions.findFirst({
          where: eq(questionOptions.id, id),
        });
        if (!option) return err("not_found", "Answer option not found.");
        current = option.text;
      }

      const text = await improveText(
        { tx, companyId: auth.companyId },
        { fieldKind: field as ImproveFieldKind, current, instruction }
      );

      if (field === "lessonTitle") {
        await tx.update(lessons).set({ title: text }).where(eq(lessons.id, id));
      } else if (field === "lessonTeaching") {
        await tx.update(lessons).set({ teachingText: text }).where(eq(lessons.id, id));
      } else if (field === "questionPrompt") {
        await tx.update(questions).set({ question: text }).where(eq(questions.id, id));
      } else if (field === "explanation") {
        await tx.update(questions).set({ explanation: text }).where(eq(questions.id, id));
      } else {
        await tx.update(questionOptions).set({ text }).where(eq(questionOptions.id, id));
      }

      revalidatePath("/studio", "layout");
      revalidatePath("/learn");
      return ok({ text });
    });
  });

/* ───────────────────────── Question ───────────────────────── */

export const createQuestion = async (input: unknown): Promise<Result<{ id: number }>> =>
  guard<{ id: number }>(async () => {
    const parsed = questionCreateSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const auth = await requireAuthor();

    return scoped<Result<{ id: number }>>(auth, async (tx) => {
      const lesson = await tx.query.lessons.findFirst({
        where: eq(lessons.id, parsed.data.lessonId),
        with: { unit: { with: { module: true } } },
      });
      if (!lesson) return err("not_found", "Lesson not found.");

      const [question] = await tx
        .insert(questions)
        .values({
          companyId: auth.companyId,
          lessonId: parsed.data.lessonId,
          type: parsed.data.type,
          question: parsed.data.question,
          explanation: parsed.data.explanation ?? null,
          order: await nextOrder(tx, questions, "lesson_id", parsed.data.lessonId),
        })
        .returning();

      await tx.insert(questionOptions).values(
        parsed.data.options.map((option) => ({
          companyId: auth.companyId,
          questionId: question.id,
          text: option.text,
          correct: option.correct,
        }))
      );

      revalidatePath(`/studio/${lesson.unit.module.courseId}`);
      return ok({ id: question.id });
    });
  });

export const updateQuestion = async (input: unknown): Promise<Result<null>> =>
  guard<null>(async () => {
    const parsed = questionUpdateSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const auth = await requireAuthor();

    return scoped<Result<null>>(auth, async (tx) => {
      const question = await tx.query.questions.findFirst({
        where: eq(questions.id, parsed.data.questionId),
        with: { lesson: { with: { unit: { with: { module: true } } } } },
      });
      if (!question) return err("not_found", "Question not found.");

      await tx
        .update(questions)
        .set({
          question: parsed.data.question,
          explanation: parsed.data.explanation ?? null,
        })
        .where(eq(questions.id, parsed.data.questionId));

      // Options are replaced wholesale (simplest correct semantics).
      await tx
        .delete(questionOptions)
        .where(eq(questionOptions.questionId, parsed.data.questionId));
      await tx.insert(questionOptions).values(
        parsed.data.options.map((option) => ({
          companyId: auth.companyId,
          questionId: parsed.data.questionId,
          text: option.text,
          correct: option.correct,
        }))
      );

      revalidatePath(`/studio/${question.lesson.unit.module.courseId}`);
      return ok(null);
    });
  });

/* ───────────────────────── Delete (cascades via FKs) ───────────────────────── */

const makeDelete = (
  table: typeof modules | typeof units | typeof lessons | typeof questions
) =>
  async (input: unknown): Promise<Result<null>> =>
    guard<null>(async () => {
      const parsed = idSchema.safeParse(input);
      if (!parsed.success) return fromZod(parsed.error);

      const auth = await requireAuthor();

      return scoped<Result<null>>(auth, async (tx) => {
        await tx.delete(table).where(eq(table.id, parsed.data.id));
        revalidatePath("/studio", "layout");
        return ok(null);
      });
    });

export const deleteModule = makeDelete(modules);
export const deleteUnit = makeDelete(units);
export const deleteLesson = makeDelete(lessons);
export const deleteQuestion = makeDelete(questions);

/* ───────────────────────── Publish (D6/D7) ───────────────────────── */

export const publishCourse = async (input: unknown): Promise<Result<{ version: number }>> =>
  guard<{ version: number }>(async () => {
    const parsed = publishSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const auth = await requireAuthor();

    const published = await scoped(auth, async (tx) => {
      const course = await tx.query.courses.findFirst({
        where: eq(courses.id, parsed.data.courseId),
      });
      if (!course) return null;

      const lessonRows = await tx.execute<{ id: number }>(sql`
        SELECT l.id FROM lessons l
        JOIN units u ON u.id = l.unit_id
        JOIN modules m ON m.id = u.module_id
        WHERE m.course_id = ${parsed.data.courseId}
      `);
      const lessonIds = lessonRows.rows.map((r) => r.id);

      const nextVersionResult = await tx.execute<{ next: number }>(sql`
        SELECT COALESCE(MAX(version), 0) + 1 AS next
        FROM content_versions WHERE course_id = ${parsed.data.courseId}
      `);
      const version = nextVersionResult.rows[0]?.next ?? 1;

      const [contentVersion] = await tx
        .insert(contentVersions)
        .values({
          companyId: auth.companyId,
          courseId: parsed.data.courseId,
          version,
          publishedBy: auth.userId,
        })
        .returning();

      await tx
        .update(courses)
        .set({ activeContentVersionId: contentVersion.id })
        .where(eq(courses.id, parsed.data.courseId));

      // Variant-regeneration job (D7). Lives as a PENDING ai_jobs row even if
      // Inngest isn't wired yet — scopedForJob resolves tenancy from it later.
      let jobId: string | null = null;
      if (lessonIds.length > 0) {
        const [job] = await tx
          .insert(aiJobs)
          .values({
            companyId: auth.companyId,
            kind: "VARIANT_PREGEN",
            payload: { lessonIds, contentVersionId: contentVersion.id },
          })
          .returning();
        jobId = job.id;
      }

      return { version, jobId };
    });

    if (!published) return err("not_found", "Course not found.");

    // Fire the event OUTSIDE the transaction; never block publish on it.
    if (published.jobId && process.env.INNGEST_EVENT_KEY) {
      try {
        await inngest.send({
          name: EVENTS.variantsRequested,
          data: { jobId: published.jobId },
        });
      } catch {
        // Variant pre-gen is an enhancement; the job stays PENDING for retry.
      }
    }

    revalidatePath("/studio");
    revalidatePath(`/studio/${parsed.data.courseId}`);
    revalidatePath("/learn");
    return ok({ version: published.version });
  });

import { eq, sql } from "drizzle-orm";

import {
  lessonTranslations,
  lessons,
  optionTranslations,
  questionTranslations,
} from "@/db/schema";
import { translateLesson } from "@/lib/ai/gateway";
import type { LessonTranslationResult, TranslationSource } from "@/lib/ai/types";
import { AppActionError } from "@/shared/errors";
import { languageLabel } from "@/lib/content/languages";
import type { ScopedTx } from "@/lib/db/scoped";

/**
 * Per-lesson translation work (multi-language courses, PR-B). Shared by the
 * synchronous /api/course/translate route (the only caller today).
 *
 * One lesson is the unit of work — small, reliable LLM call, resumable: the
 * existence of a lesson_translations row for (lesson, lang) is the completion
 * marker, so a re-run picks up only the lessons still missing. Base content
 * rows stay the PRIMARY language; these side tables hold the rest, keyed by
 * lang, mapped back onto base ids by ORDER (questions by display order, options
 * by id). The gateway pins the model's output counts to the source, so the
 * index mapping here is always aligned.
 */

/** Ids + ordered option ids for one lesson — the mapping skeleton. */
type LessonSkeleton = {
  id: number;
  questions: Array<{ id: number; options: Array<{ id: number }> }>;
};

export type LoadedLesson = {
  skeleton: LessonSkeleton;
  source: TranslationSource;
};

/** Load a lesson's base (primary-language) content, ordered for mapping. */
export const loadLessonSource = async (
  tx: ScopedTx,
  lessonId: number
): Promise<LoadedLesson | null> => {
  const lesson = await tx.query.lessons.findFirst({
    where: eq(lessons.id, lessonId),
    columns: { id: true, title: true, teachingText: true },
    with: {
      questions: {
        orderBy: (q, { asc }) => [asc(q.order), asc(q.id)],
        columns: { id: true, question: true, explanation: true },
        with: {
          questionOptions: {
            orderBy: (o, { asc }) => [asc(o.id)],
            columns: { id: true, text: true },
          },
        },
      },
    },
  });

  if (!lesson) return null;

  return {
    skeleton: {
      id: lesson.id,
      questions: lesson.questions.map((q) => ({
        id: q.id,
        options: q.questionOptions.map((o) => ({ id: o.id })),
      })),
    },
    source: {
      title: lesson.title,
      teachingText: lesson.teachingText,
      questions: lesson.questions.map((q) => ({
        question: q.question,
        explanation: q.explanation,
        options: q.questionOptions.map((o) => o.text),
      })),
    },
  };
};

export type TranslationWrites = {
  lesson: {
    lessonId: number;
    lang: string;
    title: string;
    teachingText: string | null;
  };
  questions: Array<{
    questionId: number;
    lang: string;
    question: string;
    explanation: string | null;
  }>;
  options: Array<{ optionId: number; lang: string; text: string }>;
};

/**
 * PURE: map a validated translation back onto the lesson's base ids by index.
 * The gateway guarantees matching counts; this still guards (a mismatch here
 * would mean a contract break upstream) rather than silently misaligning.
 */
export const planTranslationWrites = (args: {
  lang: string;
  skeleton: LessonSkeleton;
  translation: LessonTranslationResult;
}): TranslationWrites => {
  const { lang, skeleton, translation } = args;

  if (translation.questions.length !== skeleton.questions.length) {
    throw new Error(
      `translation question count ${translation.questions.length} != ${skeleton.questions.length}`
    );
  }

  const questions: TranslationWrites["questions"] = [];
  const options: TranslationWrites["options"] = [];

  skeleton.questions.forEach((question, qIndex) => {
    const tq = translation.questions[qIndex];
    if (tq.options.length !== question.options.length) {
      throw new Error(
        `translation option count ${tq.options.length} != ${question.options.length} (question ${qIndex + 1})`
      );
    }
    questions.push({
      questionId: question.id,
      lang,
      question: tq.question,
      explanation: tq.explanation,
    });
    question.options.forEach((option, oIndex) => {
      options.push({ optionId: option.id, lang, text: tq.options[oIndex] });
    });
  });

  return {
    lesson: {
      lessonId: skeleton.id,
      lang,
      title: translation.title,
      teachingText: translation.teachingText,
    },
    questions,
    options,
  };
};

/** Persist the translation rows, upserting on (parent, lang). */
const writeTranslations = async (
  tx: ScopedTx,
  companyId: string,
  writes: TranslationWrites
): Promise<void> => {
  await tx
    .insert(lessonTranslations)
    .values({ companyId, ...writes.lesson })
    .onConflictDoUpdate({
      target: [lessonTranslations.lessonId, lessonTranslations.lang],
      set: {
        title: sql`excluded.title`,
        teachingText: sql`excluded.teaching_text`,
        updatedAt: sql`now()`,
      },
    });

  if (writes.questions.length > 0) {
    await tx
      .insert(questionTranslations)
      .values(writes.questions.map((q) => ({ companyId, ...q })))
      .onConflictDoUpdate({
        target: [questionTranslations.questionId, questionTranslations.lang],
        set: {
          question: sql`excluded.question`,
          explanation: sql`excluded.explanation`,
          updatedAt: sql`now()`,
        },
      });
  }

  if (writes.options.length > 0) {
    await tx
      .insert(optionTranslations)
      .values(writes.options.map((o) => ({ companyId, ...o })))
      .onConflictDoUpdate({
        target: [optionTranslations.optionId, optionTranslations.lang],
        set: { text: sql`excluded.text`, updatedAt: sql`now()` },
      });
  }
};

/**
 * Translate ONE lesson into `lang` and persist it. Runs inside the caller's
 * scoped transaction (RLS-enforced); the gateway call resolves the provider +
 * meters usage on the same tx, mirroring the image/voiceover runner.
 */
export const translateLessonInto = async (
  tx: ScopedTx,
  companyId: string,
  lessonId: number,
  lang: string
): Promise<{ lessonId: number }> => {
  const loaded = await loadLessonSource(tx, lessonId);
  if (!loaded) throw new AppActionError("not_found", "Lesson not found.");

  const translation = await translateLesson(
    { tx, companyId },
    { targetLanguageLabel: languageLabel(lang), source: loaded.source }
  );

  const writes = planTranslationWrites({
    lang,
    skeleton: loaded.skeleton,
    translation,
  });

  await writeTranslations(tx, companyId, writes);

  return { lessonId };
};

/** The next lesson in the course (tree order) lacking a translation for `lang`. */
export const nextUntranslatedLessonId = async (
  tx: ScopedTx,
  courseId: number,
  lang: string
): Promise<number | null> => {
  const result = await tx.execute<{ id: number }>(sql`
    SELECT l.id
    FROM lessons l
    JOIN units u ON u.id = l.unit_id
    JOIN modules m ON m.id = u.module_id
    WHERE m.course_id = ${courseId}
      AND NOT EXISTS (
        SELECT 1 FROM lesson_translations lt
        WHERE lt.lesson_id = l.id AND lt.lang = ${lang}
      )
    ORDER BY m."order", u."order", l."order", l.id
    LIMIT 1
  `);
  return result.rows[0]?.id ?? null;
};

/** How many lessons in the course still lack a translation for `lang`. */
export const countUntranslatedLessons = async (
  tx: ScopedTx,
  courseId: number,
  lang: string
): Promise<number> => {
  const result = await tx.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n
    FROM lessons l
    JOIN units u ON u.id = l.unit_id
    JOIN modules m ON m.id = u.module_id
    WHERE m.course_id = ${courseId}
      AND NOT EXISTS (
        SELECT 1 FROM lesson_translations lt
        WHERE lt.lesson_id = l.id AND lt.lang = ${lang}
      )
  `);
  return result.rows[0]?.n ?? 0;
};

/** Total lessons in the course (the translation denominator). */
export const countLessonsInCourse = async (
  tx: ScopedTx,
  courseId: number
): Promise<number> => {
  const result = await tx.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n
    FROM lessons l
    JOIN units u ON u.id = l.unit_id
    JOIN modules m ON m.id = u.module_id
    WHERE m.course_id = ${courseId}
  `);
  return result.rows[0]?.n ?? 0;
};

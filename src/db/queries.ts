import { cache } from "react";

import { and, eq, isNull, sql } from "drizzle-orm";

import { getSession } from "@/features/auth/session";
import {
  DEFAULT_LANGUAGE,
  resolveReadingLanguage,
} from "@/features/courses/languages";
import { scoped } from "@/shared/db/scoped";

import { courseTranslations, courses, userProgress } from "./schema";

/** The learner's resolved reading language + the company primary. Cached per
 * request; the learn reads overlay unit/course titles into `lang`. */
const getReadingLang = cache(
  async (): Promise<{ lang: string; primary: string }> => {
    const session = await getSession();
    if (!session) return { lang: DEFAULT_LANGUAGE, primary: DEFAULT_LANGUAGE };
    return scoped(session, async (tx) => {
      const up = await tx.query.userProgress.findFirst({
        where: eq(userProgress.userId, session.userId),
        columns: { language: true },
      });
      const settings = await tx.query.companySettings.findFirst({
        columns: { primaryLanguage: true },
      });
      const primary = settings?.primaryLanguage ?? DEFAULT_LANGUAGE;
      return { lang: resolveReadingLanguage(up?.language ?? null, primary), primary };
    });
  }
);

/**
 * Read queries (T1/T8): everything runs through scoped() so RLS confines
 * results to the session's company.
 *
 * D22 (T8): the learn page reads a single AGGREGATE outline — module/unit/
 * lesson titles + per-lesson completion counts — never the question tree.
 * Question payloads only ever load inside the lesson player, per question,
 * via the learning-loop actions.
 */

export type OutlineLesson = {
  id: number;
  title: string;
  order: number;
  total: number;
  done: number;
  completed: boolean;
};

export type OutlineUnit = {
  id: number;
  title: string;
  description: string;
  order: number;
  lessons: OutlineLesson[];
};

type LearnOutline = {
  units: OutlineUnit[];
  activeLessonId: number | undefined;
  activeLessonPercentage: number;
};

export const getCourses = cache(async () => {
  const session = await getSession();

  if (!session) return [];

  return scoped(session, (tx) =>
    tx.query.courses.findMany({ where: isNull(courses.archivedAt) })
  );
});

export const getUserProgress = cache(async () => {
  const session = await getSession();

  if (!session) return null;

  const data = await scoped(session, (tx) =>
    tx.query.userProgress.findFirst({
      where: eq(userProgress.userId, session.userId),
      with: {
        activeCourse: true,
      },
    })
  );

  if (!data) return null;

  // Overlay the active course title into the member's reading language so the
  // Learn header isn't stuck in the base language.
  if (data.activeCourse) {
    const { lang, primary } = await getReadingLang();
    if (lang !== primary) {
      const translated = await scoped(session, (tx) =>
        tx.query.courseTranslations.findFirst({
          where: and(
            eq(courseTranslations.courseId, data.activeCourse!.id),
            eq(courseTranslations.lang, lang)
          ),
          columns: { title: true },
        })
      );
      if (translated?.title) data.activeCourse.title = translated.title;
    }
  }

  return data;
});

/** Single aggregate pass over the active course (D22). */
const getLearnOutline = cache(async (): Promise<LearnOutline | null> => {
  const session = await getSession();
  const currentUserProgress = await getUserProgress();

  if (!session || !currentUserProgress?.activeCourseId) return null;

  // Overlay unit title/description into the reading language; COALESCE falls
  // back to the base when no translation row exists (incl. the primary itself).
  const { lang } = await getReadingLang();

  const result = await scoped(session, (tx) =>
    tx.execute<{
      unit_id: number;
      unit_title: string;
      unit_description: string;
      unit_order: number;
      lesson_id: number;
      lesson_title: string;
      lesson_order: number;
      total: number;
      done: number;
    }>(sql`
      SELECT u.id AS unit_id,
             COALESCE(ut.title, u.title) AS unit_title,
             COALESCE(ut.description, u.description) AS unit_description,
             u."order" AS unit_order,
             l.id AS lesson_id, l.title AS lesson_title, l."order" AS lesson_order,
             count(q.id)::int AS total,
             count(q.id) FILTER (
               WHERE EXISTS (
                 SELECT 1 FROM attempts a
                 WHERE a.question_id = q.id
                   AND a.user_id = ${session.userId}
                   AND a.correct
               )
             )::int AS done
      FROM modules m
      JOIN units u ON u.module_id = m.id
      LEFT JOIN unit_translations ut ON ut.unit_id = u.id AND ut.lang = ${lang}
      JOIN lessons l ON l.unit_id = u.id
      LEFT JOIN questions q ON q.lesson_id = l.id
      WHERE m.course_id = ${currentUserProgress.activeCourseId}
      GROUP BY u.id, ut.title, u.title, ut.description, u.description,
               u."order", m."order", l.id, l.title, l."order"
      ORDER BY m."order", u."order", l."order"
    `)
  );

  const unitsById = new Map<number, OutlineUnit>();

  for (const row of result.rows) {
    let unit = unitsById.get(row.unit_id);
    if (!unit) {
      unit = {
        id: row.unit_id,
        title: row.unit_title,
        description: row.unit_description,
        order: row.unit_order,
        lessons: [],
      };
      unitsById.set(row.unit_id, unit);
    }
    unit.lessons.push({
      id: row.lesson_id,
      title: row.lesson_title,
      order: row.lesson_order,
      total: row.total,
      done: row.done,
      completed: row.total > 0 && row.done >= row.total,
    });
  }

  const units = [...unitsById.values()];
  const allLessons = units.flatMap((unit) => unit.lessons);
  const active = allLessons.find(
    (lesson) => lesson.total > 0 && lesson.done < lesson.total
  );

  return {
    units,
    activeLessonId: active?.id,
    activeLessonPercentage:
      active && active.total > 0
        ? Math.round((active.done / active.total) * 100)
        : 0,
  };
});

export const getUnits = cache(async (): Promise<OutlineUnit[]> => {
  const outline = await getLearnOutline();
  return outline?.units ?? [];
});

export const getCourseProgress = cache(async () => {
  const outline = await getLearnOutline();

  if (!outline) return null;

  return {
    activeLesson: outline.activeLessonId
      ? { id: outline.activeLessonId }
      : undefined,
    activeLessonId: outline.activeLessonId,
  };
});

export const getLessonPercentage = cache(async () => {
  const outline = await getLearnOutline();
  return outline?.activeLessonPercentage ?? 0;
});

export const getCourseById = cache(async (courseId: number) => {
  const session = await getSession();

  if (!session) return null;

  const data = await scoped(session, (tx) =>
    tx.query.courses.findFirst({
      where: (courses, { eq }) => eq(courses.id, courseId),
      with: {
        modules: {
          orderBy: (modules, { asc }) => [asc(modules.order)],
          with: {
            units: {
              orderBy: (units, { asc }) => [asc(units.order)],
              with: {
                lessons: {
                  orderBy: (lessons, { asc }) => [asc(lessons.order)],
                },
              },
            },
          },
        },
      },
    })
  );

  return data ?? null;
});

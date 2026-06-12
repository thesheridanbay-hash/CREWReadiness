import { cache } from "react";

import { and, eq } from "drizzle-orm";

import { getSession } from "@/lib/auth/session";
import { scoped } from "@/lib/db/scoped";

import { attempts, lessons, modules, userProgress } from "./schema";

/**
 * Read queries (T1): every query runs through scoped() — a transaction with
 * `app.company_id` set — so RLS confines results to the session's company.
 * Question completion derives from the append-only attempts log (D21);
 * there is no separate per-question progress table.
 *
 * NOTE (D22/P1): getUnits/getCourseProgress load the full course tree. The
 * outline-first + per-unit lazy learn page replaces these access patterns in
 * P1; keep them simple until then.
 */

const correctAttemptsFor = (userId: string) => ({
  where: and(eq(attempts.userId, userId), eq(attempts.correct, true)),
  limit: 1,
});

export const getCourses = cache(async () => {
  const session = await getSession();

  if (!session) return [];

  return scoped(session, (tx) => tx.query.courses.findMany());
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

  return data ?? null;
});

/**
 * Units of the active course (course → modules → units flattened, ordered by
 * module then unit), each lesson annotated with completion state.
 */
export const getUnits = cache(async () => {
  const session = await getSession();
  const currentUserProgress = await getUserProgress();

  if (!session || !currentUserProgress?.activeCourseId) return [];

  const courseModules = await scoped(session, (tx) =>
    tx.query.modules.findMany({
      where: eq(modules.courseId, currentUserProgress.activeCourseId!),
      orderBy: (modules, { asc }) => [asc(modules.order)],
      with: {
        units: {
          orderBy: (units, { asc }) => [asc(units.order)],
          with: {
            lessons: {
              orderBy: (lessons, { asc }) => [asc(lessons.order)],
              with: {
                questions: {
                  orderBy: (questions, { asc }) => [asc(questions.order)],
                  with: {
                    attempts: correctAttemptsFor(session.userId),
                  },
                },
              },
            },
          },
        },
      },
    })
  );

  return courseModules
    .flatMap((module) => module.units)
    .map((unit) => {
      const lessonsWithCompletedStatus = unit.lessons.map((lesson) => {
        if (lesson.questions.length === 0)
          return { ...lesson, completed: false };

        const allCompleted = lesson.questions.every(
          (question) => question.attempts.length > 0
        );

        return { ...lesson, completed: allCompleted };
      });

      return { ...unit, lessons: lessonsWithCompletedStatus };
    });
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

export const getCourseProgress = cache(async () => {
  const session = await getSession();
  const currentUserProgress = await getUserProgress();

  if (!session || !currentUserProgress?.activeCourseId) return null;

  const courseModules = await scoped(session, (tx) =>
    tx.query.modules.findMany({
      where: eq(modules.courseId, currentUserProgress.activeCourseId!),
      orderBy: (modules, { asc }) => [asc(modules.order)],
      with: {
        units: {
          orderBy: (units, { asc }) => [asc(units.order)],
          with: {
            lessons: {
              orderBy: (lessons, { asc }) => [asc(lessons.order)],
              with: {
                unit: true,
                questions: {
                  with: {
                    attempts: correctAttemptsFor(session.userId),
                  },
                },
              },
            },
          },
        },
      },
    })
  );

  const firstUncompletedLesson = courseModules
    .flatMap((module) => module.units)
    .flatMap((unit) => unit.lessons)
    .find((lesson) =>
      lesson.questions.some((question) => question.attempts.length === 0)
    );

  return {
    activeLesson: firstUncompletedLesson,
    activeLessonId: firstUncompletedLesson?.id,
  };
});

export const getLesson = cache(async (id?: number) => {
  const session = await getSession();

  if (!session) return null;

  const courseProgress = await getCourseProgress();
  const lessonId = id || courseProgress?.activeLessonId;

  if (!lessonId) return null;

  const data = await scoped(session, (tx) =>
    tx.query.lessons.findFirst({
      where: eq(lessons.id, lessonId),
      with: {
        questions: {
          orderBy: (questions, { asc }) => [asc(questions.order)],
          with: {
            questionOptions: true,
            attempts: correctAttemptsFor(session.userId),
          },
        },
      },
    })
  );

  if (!data || !data.questions) return null;

  const normalizedQuestions = data.questions.map((question) => ({
    ...question,
    completed: question.attempts.length > 0,
  }));

  return { ...data, questions: normalizedQuestions };
});

export const getLessonPercentage = cache(async () => {
  const courseProgress = await getCourseProgress();

  if (!courseProgress?.activeLessonId) return 0;

  const lesson = await getLesson(courseProgress?.activeLessonId);

  if (!lesson) return 0;

  const completedQuestions = lesson.questions.filter(
    (question) => question.completed
  );

  const percentage = Math.round(
    (completedQuestions.length / lesson.questions.length) * 100
  );

  return percentage;
});

export const getTopTenUsers = cache(async () => {
  const session = await getSession();

  if (!session) return [];

  return scoped(session, (tx) =>
    tx.query.userProgress.findMany({
      orderBy: (userProgress, { desc }) => [desc(userProgress.points)],
      limit: 10,
      columns: {
        userId: true,
        userName: true,
        userImageSrc: true,
        points: true,
      },
    })
  );
});

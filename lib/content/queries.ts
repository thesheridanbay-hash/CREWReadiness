import { cache } from "react";

import { asc, eq } from "drizzle-orm";

import { courses, lessons, modules } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { scoped } from "@/lib/db/scoped";

/** Studio read queries (T10): scoped, office-role pages call these. */

export type StudioCourseSummary = {
  id: number;
  title: string;
  imageSrc: string;
  published: boolean;
  lessonCount: number;
};

export const getStudioCourses = cache(async (): Promise<StudioCourseSummary[]> => {
  const session = await getSession();
  if (!session || session.role === "employee") return [];

  return scoped(session, async (tx) => {
    const rows = await tx.query.courses.findMany({
      orderBy: [asc(courses.id)],
      with: {
        modules: { with: { units: { with: { lessons: { columns: { id: true } } } } } },
      },
    });

    return rows.map((course) => ({
      id: course.id,
      title: course.title,
      imageSrc: course.imageSrc,
      published: course.activeContentVersionId !== null,
      lessonCount: course.modules.reduce(
        (sum, module) =>
          sum + module.units.reduce((u, unit) => u + unit.lessons.length, 0),
        0
      ),
    }));
  });
});

export type CourseTree = NonNullable<Awaited<ReturnType<typeof getCourseTree>>>;

export const getCourseTree = cache(async (courseId: number) => {
  const session = await getSession();
  if (!session || session.role === "employee") return null;

  return scoped(session, async (tx) => {
    const course = await tx.query.courses.findFirst({
      where: eq(courses.id, courseId),
      with: {
        modules: {
          orderBy: [asc(modules.order)],
          with: {
            units: {
              orderBy: (u, { asc: a }) => [a(u.order)],
              with: {
                lessons: {
                  orderBy: (l, { asc: a }) => [a(l.order)],
                  with: {
                    questions: {
                      orderBy: (q, { asc: a }) => [a(q.order)],
                      with: { questionOptions: true },
                    },
                    // Lesson art (AI Course Builder) so the editor shows which
                    // images belong to which lesson + their generation status.
                    assets: {
                      orderBy: (a, { asc: ascFn }) => [ascFn(a.order)],
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    return course ?? null;
  });
});

/**
 * Lesson teaching content for the LEARNER (any role, incl. crew): the
 * plain-language brief + a representative generated image (+ voiceover audio
 * once TTS lands). Powers the "Learn" screen shown before the questions.
 * Returns null when the lesson has no teaching content (questions-only).
 */
export type LessonTeaching = {
  text: string | null;
  imageSrc: string | null;
  audioSrc: string | null;
};

export const getLessonTeaching = cache(
  async (lessonId: number): Promise<LessonTeaching | null> => {
    const session = await getSession();
    if (!session) return null;

    return scoped(session, async (tx) => {
      const lesson = await tx.query.lessons.findFirst({
        where: eq(lessons.id, lessonId),
        columns: { id: true, teachingText: true },
        with: {
          assets: { orderBy: (a, { asc: ascFn }) => [ascFn(a.order)] },
        },
      });
      if (!lesson) return null;

      const image = lesson.assets.find(
        (a) => a.status === "GENERATED" && a.mediaAssetId
      );
      const hasContent = Boolean(lesson.teachingText || image);
      if (!hasContent) return null;

      return {
        text: lesson.teachingText,
        imageSrc: image?.mediaAssetId ? `/api/media/${image.mediaAssetId}` : null,
        audioSrc: null,
      };
    });
  }
);

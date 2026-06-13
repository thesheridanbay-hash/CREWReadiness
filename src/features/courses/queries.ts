import { cache } from "react";

import { asc, desc, eq, isNotNull, isNull } from "drizzle-orm";

import { courses, lessons, modules } from "@/db/schema";
import { getSession } from "@/features/auth/session";
import { scoped } from "@/shared/db/scoped";

import { getReadingLanguage, lessonTeachingOverlay } from "./translations";

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
      where: isNull(courses.archivedAt),
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

export type ArchivedCourse = {
  id: number;
  title: string;
  imageSrc: string;
  archivedAt: Date;
};

/** Archived courses (owner): restorable, or permanently deletable. */
export const getArchivedCourses = cache(
  async (): Promise<ArchivedCourse[]> => {
    const session = await getSession();
    if (!session || session.role === "employee") return [];

    return scoped(session, async (tx) => {
      const rows = await tx.query.courses.findMany({
        where: isNotNull(courses.archivedAt),
        orderBy: [desc(courses.archivedAt)],
        columns: { id: true, title: true, imageSrc: true, archivedAt: true },
      });
      return rows.map((course) => ({
        id: course.id,
        title: course.title,
        imageSrc: course.imageSrc,
        archivedAt: course.archivedAt as Date,
      }));
    });
  }
);

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

      const generated = lesson.assets.filter(
        (a) => a.status === "GENERATED" && a.mediaAssetId
      );
      const image = generated.find((a) => a.kind !== "AUDIO");
      const audio = generated.find((a) => a.kind === "AUDIO");

      // Overlay the learner's language onto the teaching text; fall back to the
      // base (primary-language) text when this lesson isn't translated yet.
      let text = lesson.teachingText;
      const reading = await getReadingLanguage(tx, session.userId);
      if (reading.needsOverlay) {
        const overlay = await lessonTeachingOverlay(tx, lesson.id, reading.lang);
        if (overlay?.teachingText) text = overlay.teachingText;
      }

      const hasContent = Boolean(text || image);
      if (!hasContent) return null;

      return {
        text,
        imageSrc: image?.mediaAssetId ? `/api/media/${image.mediaAssetId}` : null,
        audioSrc: audio?.mediaAssetId ? `/api/media/${audio.mediaAssetId}` : null,
      };
    });
  }
);

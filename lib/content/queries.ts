import { cache } from "react";

import { asc, eq } from "drizzle-orm";

import { courses, modules } from "@/db/schema";
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

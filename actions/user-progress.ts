"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { userProgress } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { scoped } from "@/lib/db/scoped";

/**
 * Select the active course (T1): scoped writes; tenant comes from the
 * session, RLS enforces it again at the database (D14).
 *
 * NOTE: redirect() must stay OUTSIDE scoped() — it throws internally, which
 * would roll back the transaction.
 *
 * TODO(T7): typed result envelope. TODO(P1): course access becomes
 * assignment-driven.
 */
export const upsertUserProgress = async (courseId: number) => {
  const session = await getSession();

  if (!session) throw new Error("Unauthorized.");

  await scoped(session, async (tx) => {
    const course = await tx.query.courses.findFirst({
      where: (courses, { eq }) => eq(courses.id, courseId),
      with: {
        modules: {
          with: {
            units: {
              with: { lessons: true },
            },
          },
        },
      },
    });

    if (!course) throw new Error("Course not found.");

    const hasLessons = course.modules.some((module) =>
      module.units.some((unit) => unit.lessons.length > 0)
    );

    if (!hasLessons) throw new Error("Course is empty.");

    const existingUserProgress = await tx.query.userProgress.findFirst({
      where: eq(userProgress.userId, session.userId),
    });

    if (existingUserProgress) {
      await tx
        .update(userProgress)
        .set({
          activeCourseId: courseId,
          userName: session.name,
          userImageSrc: session.imageSrc,
        })
        .where(eq(userProgress.userId, session.userId));
      return;
    }

    await tx.insert(userProgress).values({
      userId: session.userId,
      companyId: session.companyId,
      activeCourseId: courseId,
      userName: session.name,
      userImageSrc: session.imageSrc,
    });
  });

  revalidatePath("/courses");
  revalidatePath("/learn");
  redirect("/learn");
};

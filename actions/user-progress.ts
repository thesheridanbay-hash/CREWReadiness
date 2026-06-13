"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { userProgress } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { scoped } from "@/lib/db/scoped";
import { err, fromZod, guard, ok, type Result } from "@/shared/errors";

const upsertUserProgressSchema = z.number().int().positive();

/**
 * Select the active course (T1/T7): scoped writes, typed envelope (D15).
 * redirect() stays OUTSIDE scoped() — it throws internally and would roll
 * back the transaction; guard() re-throws Next.js control-flow errors.
 */
export const upsertUserProgress = async (
  rawCourseId: number
): Promise<Result<null>> =>
  guard(async () => {
    const parsed = upsertUserProgressSchema.safeParse(rawCourseId);

    if (!parsed.success) return fromZod(parsed.error);

    const courseId = parsed.data;
    const session = await getSession();

    if (!session) return err("unauthorized", "Sign in to continue.");

    const outcome = await scoped(session, async (tx) => {
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

      if (!course) return "not_found" as const;

      const hasLessons = course.modules.some((module) =>
        module.units.some((unit) => unit.lessons.length > 0)
      );

      if (!hasLessons) return "empty" as const;

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
        return "updated" as const;
      }

      await tx.insert(userProgress).values({
        userId: session.userId,
        companyId: session.companyId,
        activeCourseId: courseId,
        userName: session.name,
        userImageSrc: session.imageSrc,
      });
      return "created" as const;
    });

    if (outcome === "not_found") return err("not_found", "Course not found.");
    if (outcome === "empty")
      return err("conflict", "This course has no lessons yet.");

    revalidatePath("/courses");
    revalidatePath("/learn");
    redirect("/learn");

    // Unreachable (redirect throws), but keeps the return type honest.
    return ok(null);
  });

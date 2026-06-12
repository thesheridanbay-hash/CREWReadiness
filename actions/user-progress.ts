"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import db from "@/db/drizzle";
import { getCourseById, getUserProgress } from "@/db/queries";
import { userProgress } from "@/db/schema";
import { getSession } from "@/lib/auth/session";

/**
 * NOTE (D10): hearts/shop actions removed. Points + streaks stay. Reshaped onto
 * typed envelopes in T7 and assignment-driven course access in P1.
 */
export const upsertUserProgress = async (courseId: number) => {
  const session = await getSession();

  if (!session) throw new Error("Unauthorized.");

  const course = await getCourseById(courseId);

  if (!course) throw new Error("Course not found.");

  if (!course.units.length || !course.units[0].lessons.length)
    throw new Error("Course is empty.");

  const existingUserProgress = await getUserProgress();

  if (existingUserProgress) {
    await db
      .update(userProgress)
      .set({
        activeCourseId: courseId,
        userName: session.name,
        userImageSrc: session.imageSrc,
      })
      .where(eq(userProgress.userId, session.userId));

    revalidatePath("/courses");
    revalidatePath("/learn");
    redirect("/learn");
  }

  await db.insert(userProgress).values({
    userId: session.userId,
    activeCourseId: courseId,
    userName: session.name,
    userImageSrc: session.imageSrc,
  });

  revalidatePath("/courses");
  revalidatePath("/learn");
  redirect("/learn");
};

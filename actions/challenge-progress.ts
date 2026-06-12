"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { attempts, questions, userProgress } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { scoped } from "@/lib/db/scoped";

/**
 * Record a correct answer (T1): appends to the attempts log (D21) and awards
 * points. Completion is derived from attempts — there is no separate
 * per-question progress table. Wrong answers are not persisted yet; that
 * arrives with the state machine (T3), which will also pin sessions to a
 * content version and route wrong answers through the reteach loop.
 *
 * TODO(T7): replace thrown errors with the typed result envelope.
 */
export const recordCorrectAnswer = async (questionId: number) => {
  const session = await getSession();

  if (!session) throw new Error("Unauthorized.");

  const lessonId = await scoped(session, async (tx) => {
    const question = await tx.query.questions.findFirst({
      where: eq(questions.id, questionId),
    });

    if (!question) throw new Error("Question not found.");

    const currentUserProgress = await tx.query.userProgress.findFirst({
      where: eq(userProgress.userId, session.userId),
    });

    if (!currentUserProgress) throw new Error("User progress not found.");

    await tx.insert(attempts).values({
      companyId: session.companyId,
      userId: session.userId,
      questionId,
      surface: "ORIGINAL",
      correct: true,
    });

    await tx
      .update(userProgress)
      .set({
        points: currentUserProgress.points + 10,
      })
      .where(eq(userProgress.userId, session.userId));

    return question.lessonId;
  });

  revalidatePath("/learn");
  revalidatePath("/lesson");
  revalidatePath("/quests");
  revalidatePath("/leaderboard");
  revalidatePath(`/lesson/${lessonId}`);
};

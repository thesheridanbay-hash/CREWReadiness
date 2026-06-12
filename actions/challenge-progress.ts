"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { attempts, questions, userProgress } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { scoped } from "@/lib/db/scoped";
import { err, fromZod, guard, ok, type Result } from "@/lib/errors";

const recordCorrectAnswerSchema = z.number().int().positive();

/**
 * Record a correct answer (T1/T7): appends to the attempts log (D21), awards
 * points, returns a typed envelope (D15). Wrong answers are not persisted
 * yet; the state machine (T3) takes over per-attempt persistence in P1.
 */
export const recordCorrectAnswer = async (
  rawQuestionId: number
): Promise<Result<{ lessonId: number }>> =>
  guard(async () => {
    const parsed = recordCorrectAnswerSchema.safeParse(rawQuestionId);

    if (!parsed.success) return fromZod(parsed.error);

    const questionId = parsed.data;
    const session = await getSession();

    if (!session) return err("unauthorized", "Sign in to continue.");

    const result = await scoped(session, async (tx) => {
      const question = await tx.query.questions.findFirst({
        where: eq(questions.id, questionId),
      });

      if (!question) return null;

      const currentUserProgress = await tx.query.userProgress.findFirst({
        where: eq(userProgress.userId, session.userId),
      });

      if (!currentUserProgress) return null;

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

      return { lessonId: question.lessonId };
    });

    if (!result) return err("not_found", "Question or progress not found.");

    revalidatePath("/learn");
    revalidatePath("/lesson");
    revalidatePath("/quests");
    revalidatePath("/leaderboard");
    revalidatePath(`/lesson/${result.lessonId}`);

    return ok(result);
  });

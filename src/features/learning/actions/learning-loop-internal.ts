import { asc, eq, sql } from "drizzle-orm";

import {
  attempts,
  learningSessions,
  member,
  notifications,
  parkedConcepts,
  questionVariants,
  questions,
  userProgress,
} from "@/db/schema";
import {
  getReadingLanguage,
  optionTextOverlay,
  questionTextOverlay,
} from "@/features/courses/translations";
import { type ScopedTx } from "@/shared/db/scoped";
import type {
  LearningLoopEvent,
  LearningLoopSession,
} from "@/features/learning/types";
import {
  pickVariantIndex,
  summarizeEffects,
  type LoopView,
  type ProgressView,
  type QuestionSurfaceView,
} from "@/features/learning/views";

export type SessionRow = typeof learningSessions.$inferSelect;

export const toMachineSession = (row: SessionRow): LearningLoopSession => ({
  id: row.id,
  companyId: row.companyId,
  userId: row.userId,
  lessonId: row.lessonId,
  contentVersionId: row.contentVersionId,
  status: row.status,
  activeQuestionId: row.activeQuestionId,
  step: row.step,
  reteachCycle: row.reteachCycle,
  startedAt: row.startedAt,
  updatedAt: row.updatedAt,
});

/* ───────────────────────── Read helpers (scoped) ───────────────────────── */

export const lessonQuestionIds = async (tx: ScopedTx, lessonId: number) =>
  (
    await tx.query.questions.findMany({
      where: eq(questions.lessonId, lessonId),
      orderBy: [asc(questions.order)],
      columns: { id: true },
    })
  ).map((q) => q.id);

export const progressFor = async (
  tx: ScopedTx,
  userId: string,
  lessonId: number
): Promise<ProgressView> => {
  const result = await tx.execute<{ total: number; completed: number }>(sql`
    SELECT count(q.id)::int AS total,
           count(q.id) FILTER (
             WHERE EXISTS (
               SELECT 1 FROM attempts a
               WHERE a.question_id = q.id AND a.user_id = ${userId} AND a.correct
             )
           )::int AS completed
    FROM questions q WHERE q.lesson_id = ${lessonId}
  `);

  return {
    total: result.rows[0]?.total ?? 0,
    completed: result.rows[0]?.completed ?? 0,
  };
};

export const priorWrongAttempts = async (
  tx: ScopedTx,
  userId: string,
  questionId: number
): Promise<number> => {
  const result = await tx.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM attempts
    WHERE user_id = ${userId} AND question_id = ${questionId} AND NOT correct
  `);
  return result.rows[0]?.n ?? 0;
};

export const providerConfigured = async (tx: ScopedTx): Promise<boolean> => {
  const result = await tx.execute<{ provider: string | null }>(
    sql`SELECT provider FROM app_get_active_provider()`
  );
  return Boolean(result.rows[0]?.provider);
};

/* ───────────────────────── View hydration ───────────────────────── */

export const originalSurface = async (
  tx: ScopedTx,
  questionId: number,
  overlayLang: string | null
): Promise<QuestionSurfaceView | null> => {
  const question = await tx.query.questions.findFirst({
    where: eq(questions.id, questionId),
    with: { questionOptions: true },
  });

  if (!question) return null;

  // Overlay the learner's language onto the prompt + options; each field falls
  // back to the base (primary-language) text when its translation is missing.
  let prompt = question.question;
  let optionText = new Map<number, string>();
  if (overlayLang) {
    const [questionOverlay, optionOverlay] = [
      await questionTextOverlay(tx, question.id, overlayLang),
      await optionTextOverlay(
        tx,
        question.questionOptions.map((o) => o.id),
        overlayLang
      ),
    ];
    if (questionOverlay?.question) prompt = questionOverlay.question;
    optionText = optionOverlay;
  }

  return {
    kind: "ORIGINAL",
    questionId: question.id,
    prompt,
    questionType: question.type,
    options: question.questionOptions.map((option) => ({
      ref: option.id,
      text: optionText.get(option.id) ?? option.text,
      imageSrc: option.imageSrc,
      audioSrc: option.audioSrc,
    })),
  };
};

/** Variant surface for the active cycle; falls back to the original (D7 chain). */
export const variantOrOriginalSurface = async (
  tx: ScopedTx,
  questionId: number,
  cycle: number,
  overlayLang: string | null
): Promise<QuestionSurfaceView | null> => {
  const variants = await tx.query.questionVariants.findMany({
    where: eq(questionVariants.questionId, questionId),
    orderBy: [asc(questionVariants.id)],
  });

  const index = pickVariantIndex(variants.length, questionId, cycle);

  if (index < 0) return originalSurface(tx, questionId, overlayLang);

  const variant = variants[index];

  return {
    kind: "VARIANT",
    questionId,
    variantId: variant.id,
    prompt: variant.prompt,
    options: variant.options.map((option, ref) => ({
      ref,
      text: option.text,
    })),
  };
};

export const hydrateCurrentView = async (
  tx: ScopedTx,
  row: SessionRow,
  pointsEarned: number,
  banner: "PARKED" | null
): Promise<LoopView> => {
  const progress = await progressFor(tx, row.userId, row.lessonId);

  if (row.status === "COMPLETED") {
    return { type: "COMPLETE", pointsEarned, progress, banner };
  }

  // Resolve the learner's reading language once; null = render base content.
  const reading = await getReadingLanguage(tx, row.userId);
  const overlayLang = reading.needsOverlay ? reading.lang : null;

  if (row.step === "EXPLAIN" && row.activeQuestionId !== null) {
    const question = await tx.query.questions.findFirst({
      where: eq(questions.id, row.activeQuestionId),
      columns: { explanation: true },
    });
    let explanation = question?.explanation ?? null;
    if (overlayLang) {
      const overlay = await questionTextOverlay(
        tx,
        row.activeQuestionId,
        overlayLang
      );
      if (overlay?.explanation) explanation = overlay.explanation;
    }
    return {
      type: "EXPLAIN",
      questionId: row.activeQuestionId,
      explanation:
        explanation ??
        "Take another look at the question — think about what keeps you and the crew safe.",
      progress,
    };
  }

  if (row.step === "AI_RETEACH" && row.activeQuestionId !== null) {
    return { type: "RETEACH", questionId: row.activeQuestionId, progress };
  }

  if (row.activeQuestionId === null) {
    return { type: "COMPLETE", pointsEarned, progress, banner };
  }

  const surface =
    row.reteachCycle > 0
      ? await variantOrOriginalSurface(
          tx,
          row.activeQuestionId,
          row.reteachCycle,
          overlayLang
        )
      : await originalSurface(tx, row.activeQuestionId, overlayLang);

  if (!surface) return { type: "COMPLETE", pointsEarned, progress, banner };

  return { type: "QUESTION", surface, progress, banner };
};

/* ───────────────────────── Effect persistence ───────────────────────── */

export const isUniqueViolation = (error: unknown): boolean => {
  const code =
    (error as { code?: string })?.code ??
    (error as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
};

export const persistTransition = async (
  tx: ScopedTx,
  prev: SessionRow,
  next: LearningLoopSession,
  event: Extract<LearningLoopEvent, { type: "ANSWER_SUBMITTED" }> | null,
  effects: ReturnType<typeof summarizeEffects>,
  attemptMeta: { surface: "ORIGINAL" | "VARIANT"; variantId: number | null }
): Promise<void> => {
  if (effects.persistAttempt && event) {
    await tx.insert(attempts).values({
      companyId: prev.companyId,
      userId: prev.userId,
      sessionId: prev.id,
      questionId: event.questionId,
      variantId: attemptMeta.variantId,
      surface: attemptMeta.surface,
      correct: event.correct,
      cycle: prev.reteachCycle,
      idempotencyKey: event.idempotencyKey,
    });
  }

  if (effects.pointsAwarded > 0) {
    await tx
      .insert(userProgress)
      .values({
        userId: prev.userId,
        companyId: prev.companyId,
        points: effects.pointsAwarded,
      })
      .onConflictDoUpdate({
        target: userProgress.userId,
        set: {
          points: sql`${userProgress.points} + ${effects.pointsAwarded}`,
        },
      });
  }

  if (effects.parked && event) {
    await tx.insert(parkedConcepts).values({
      companyId: prev.companyId,
      userId: prev.userId,
      questionId: event.questionId,
      lessonId: prev.lessonId,
      sessionId: prev.id,
    });

    // FLAG_MANAGER: notify company owners/admins (D23).
    const managers = await tx.query.member.findMany({
      where: eq(member.organizationId, prev.companyId),
    });

    for (const manager of managers) {
      if (manager.role === "owner" || manager.role === "admin") {
        await tx.insert(notifications).values({
          companyId: prev.companyId,
          userId: manager.userId,
          type: "concept_parked",
          payload: {
            employeeUserId: prev.userId,
            questionId: event.questionId,
            lessonId: prev.lessonId,
          },
        });
      }
    }
  }

  await tx
    .update(learningSessions)
    .set({
      status: next.status,
      activeQuestionId: next.activeQuestionId,
      step: next.step,
      reteachCycle: next.reteachCycle,
      updatedAt: new Date(),
    })
    .where(eq(learningSessions.id, prev.id));
};

/* ───────────────────────── Actions ───────────────────────── */


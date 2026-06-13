"use server";

import { and, asc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  attempts,
  learningSessions,
  lessons,
  member,
  notifications,
  parkedConcepts,
  questionOptions,
  questionVariants,
  questions,
  userProgress,
} from "@/db/schema";
import { getSession } from "@/features/auth/session";
import {
  getReadingLanguage,
  optionTextOverlay,
  questionTextOverlay,
} from "@/features/courses/translations";
import { scoped, type ScopedTx } from "@/shared/db/scoped";
import { err, fromZod, guard, ok, type Result } from "@/shared/errors";
import { transition } from "@/features/learning/machine";
import type {
  LearningLoopEvent,
  LearningLoopSession,
  TransitionContext,
} from "@/features/learning/types";
import {
  nextViewShape,
  pickVariantIndex,
  summarizeEffects,
  type LoopView,
  type ProgressView,
  type QuestionSurfaceView,
} from "@/features/learning/views";

/**
 * Learning-loop actions (T8 — wires the pure machine, T3, into the product).
 *
 * Every action: zod → session → scoped transaction → machine transition →
 * effect persistence → hydrated LoopView. The machine stays pure; this file
 * owns ALL I/O. Double submits collapse via the attempts idempotency index
 * (unique violation → replay the current view, never a double-apply).
 */

export type LoopActionResult = {
  sessionId: string;
  view: LoopView;
  pointsEarned: number;
};

/* ───────────────────────── DB ↔ machine mapping ───────────────────────── */

type SessionRow = typeof learningSessions.$inferSelect;

const toMachineSession = (row: SessionRow): LearningLoopSession => ({
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

const lessonQuestionIds = async (tx: ScopedTx, lessonId: number) =>
  (
    await tx.query.questions.findMany({
      where: eq(questions.lessonId, lessonId),
      orderBy: [asc(questions.order)],
      columns: { id: true },
    })
  ).map((q) => q.id);

const progressFor = async (
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

const priorWrongAttempts = async (
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

const providerConfigured = async (tx: ScopedTx): Promise<boolean> => {
  const result = await tx.execute<{ provider: string | null }>(
    sql`SELECT provider FROM app_get_active_provider()`
  );
  return Boolean(result.rows[0]?.provider);
};

/* ───────────────────────── View hydration ───────────────────────── */

const originalSurface = async (
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
const variantOrOriginalSurface = async (
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

const hydrateCurrentView = async (
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

const isUniqueViolation = (error: unknown): boolean => {
  const code =
    (error as { code?: string })?.code ??
    (error as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
};

const persistTransition = async (
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

const startSchema = z.number().int().positive();

export const startOrResumeSession = async (
  rawLessonId: number
): Promise<Result<LoopActionResult>> =>
  guard(async () => {
    const parsed = startSchema.safeParse(rawLessonId);
    if (!parsed.success) return fromZod(parsed.error);

    const auth = await getSession();
    if (!auth) return err("unauthorized", "Sign in to continue.");

    const lessonId = parsed.data;

    return scoped(auth, async (tx) => {
      const lesson = await tx.query.lessons.findFirst({
        where: eq(lessons.id, lessonId),
        with: { unit: { with: { module: { with: { course: true } } } } },
      });

      if (!lesson) return err("not_found", "Lesson not found.");

      const questionIds = await lessonQuestionIds(tx, lessonId);
      if (questionIds.length === 0)
        return err("conflict", "This lesson has no questions yet.");

      let row = await tx.query.learningSessions.findFirst({
        where: and(
          eq(learningSessions.userId, auth.userId),
          eq(learningSessions.lessonId, lessonId),
          eq(learningSessions.status, "ACTIVE")
        ),
      });

      if (!row) {
        // First question without a correct attempt; practice replays start over.
        const progress = await progressFor(tx, auth.userId, lessonId);
        let startQuestionId = questionIds[0];

        if (progress.completed < progress.total) {
          for (const id of questionIds) {
            const result = await tx.execute<{ n: number }>(sql`
              SELECT count(*)::int AS n FROM attempts
              WHERE user_id = ${auth.userId} AND question_id = ${id} AND correct
            `);
            if ((result.rows[0]?.n ?? 0) === 0) {
              startQuestionId = id;
              break;
            }
          }
        }

        const inserted = await tx
          .insert(learningSessions)
          .values({
            companyId: auth.companyId,
            userId: auth.userId,
            lessonId,
            contentVersionId:
              lesson.unit.module.course.activeContentVersionId ?? 0,
            activeQuestionId: startQuestionId,
          })
          .returning();
        row = inserted[0];
      }

      const view = await hydrateCurrentView(tx, row, 0, null);
      return ok({ sessionId: row.id, view, pointsEarned: 0 });
    });
  });

const submitSchema = z.object({
  sessionId: z.string().uuid(),
  questionId: z.number().int().positive(),
  surface: z.enum(["ORIGINAL", "VARIANT"]),
  variantId: z.number().int().positive().nullable(),
  optionRef: z.number().int().min(0),
  idempotencyKey: z.string().min(8).max(128),
});

export const submitAnswer = async (
  input: z.infer<typeof submitSchema>
): Promise<Result<LoopActionResult>> =>
  guard(async () => {
    const parsed = submitSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const auth = await getSession();
    if (!auth) return err("unauthorized", "Sign in to continue.");

    const { sessionId, questionId, surface, variantId, optionRef, idempotencyKey } =
      parsed.data;

    return scoped(auth, async (tx) => {
      const row = await tx.query.learningSessions.findFirst({
        where: eq(learningSessions.id, sessionId),
      });

      if (!row || row.userId !== auth.userId)
        return err("not_found", "Session not found.");

      /* Resolve correctness server-side for either surface. */
      let correct: boolean;
      let resolvedVariantId: number | null = null;

      if (surface === "ORIGINAL") {
        const option = await tx.query.questionOptions.findFirst({
          where: and(
            eq(questionOptions.id, optionRef),
            eq(questionOptions.questionId, questionId)
          ),
        });
        if (!option) return err("not_found", "Answer option not found.");
        correct = option.correct;
      } else {
        if (!variantId) return err("validation", "variantId required.");
        const variant = await tx.query.questionVariants.findFirst({
          where: and(
            eq(questionVariants.id, variantId),
            eq(questionVariants.questionId, questionId)
          ),
        });
        const option = variant?.options[optionRef];
        if (!option) return err("not_found", "Variant option not found.");
        correct = option.correct;
        resolvedVariantId = variantId;
      }

      const ctx: TransitionContext = {
        nextQuestionId: await (async () => {
          const ids = await lessonQuestionIds(tx, row.lessonId);
          const index = ids.indexOf(row.activeQuestionId ?? -1);
          return index >= 0 && index + 1 < ids.length ? ids[index + 1] : null;
        })(),
        priorWrongAttempts: await priorWrongAttempts(tx, auth.userId, questionId),
        // TODO(P3): per-question daily reteach budget once reteach calls are
        // individually logged; provider presence is the gate until then.
        reteachAvailableToday: await providerConfigured(tx),
      };

      const event: LearningLoopEvent = {
        type: "ANSWER_SUBMITTED",
        sessionId,
        idempotencyKey,
        questionId,
        optionId: optionRef,
        correct,
      };

      const result = transition(toMachineSession(row), event, ctx);

      if (!result.ok) {
        if (result.code === "SESSION_NOT_ACTIVE")
          return err("conflict", "This session has ended. Head back to Learn.");
        return err("conflict", result.message);
      }

      const effects = summarizeEffects(result.effects);

      try {
        await persistTransition(tx, row, result.session, event, effects, {
          surface,
          variantId: resolvedVariantId,
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          // Double submit: replay the current state without re-applying.
          const view = await hydrateCurrentView(tx, row, 0, null);
          return ok({ sessionId, view, pointsEarned: 0 });
        }
        throw error;
      }

      const shape = nextViewShape(result);
      const updated: SessionRow = {
        ...row,
        status: result.session.status,
        activeQuestionId: result.session.activeQuestionId,
        step: result.session.step,
        reteachCycle: result.session.reteachCycle,
      };

      const view = await hydrateCurrentView(
        tx,
        updated,
        effects.pointsAwarded,
        shape.type === "QUESTION" || shape.type === "COMPLETE"
          ? shape.banner
          : null
      );

      if (effects.completed) {
        revalidatePath("/learn");
        revalidatePath("/leaderboard");
        revalidatePath("/quests");
      }

      return ok({ sessionId, view, pointsEarned: effects.pointsAwarded });
    });
  });

const ackSchema = z.object({
  sessionId: z.string().uuid(),
  questionId: z.number().int().positive(),
  idempotencyKey: z.string().min(8).max(128),
});

const simpleEvent = async (
  input: z.infer<typeof ackSchema>,
  type: "EXPLAIN_ACKNOWLEDGED" | "RETEACH_COMPLETED"
): Promise<Result<LoopActionResult>> =>
  guard(async () => {
    const parsed = ackSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const auth = await getSession();
    if (!auth) return err("unauthorized", "Sign in to continue.");

    const { sessionId, questionId, idempotencyKey } = parsed.data;

    return scoped(auth, async (tx) => {
      const row = await tx.query.learningSessions.findFirst({
        where: eq(learningSessions.id, sessionId),
      });

      if (!row || row.userId !== auth.userId)
        return err("not_found", "Session not found.");

      const event: LearningLoopEvent =
        type === "EXPLAIN_ACKNOWLEDGED"
          ? { type, sessionId, idempotencyKey, questionId }
          : { type, sessionId, idempotencyKey, questionId, source: "LIVE_STREAM" };

      const result = transition(toMachineSession(row), event, {
        nextQuestionId: null,
        priorWrongAttempts: 0,
        reteachAvailableToday: false,
      });

      if (!result.ok) {
        // Idempotent acks: already in the target step → replay current view.
        const view = await hydrateCurrentView(tx, row, 0, null);
        return ok({ sessionId, view, pointsEarned: 0 });
      }

      const effects = summarizeEffects(result.effects);
      await persistTransition(tx, row, result.session, null, effects, {
        surface: "ORIGINAL",
        variantId: null,
      });

      const updated: SessionRow = {
        ...row,
        status: result.session.status,
        activeQuestionId: result.session.activeQuestionId,
        step: result.session.step,
        reteachCycle: result.session.reteachCycle,
      };

      const view = await hydrateCurrentView(tx, updated, 0, null);
      return ok({ sessionId, view, pointsEarned: 0 });
    });
  });

export const acknowledgeExplain = async (
  input: z.infer<typeof ackSchema>
): Promise<Result<LoopActionResult>> => simpleEvent(input, "EXPLAIN_ACKNOWLEDGED");

export const completeReteach = async (
  input: z.infer<typeof ackSchema>
): Promise<Result<LoopActionResult>> => simpleEvent(input, "RETEACH_COMPLETED");

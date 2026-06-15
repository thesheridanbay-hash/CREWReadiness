"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  learningSessions,
  lessons,
  questionOptions,
  questionVariants,
} from "@/db/schema";
import { getSession } from "@/features/auth/session";
import { scoped } from "@/shared/db/scoped";
import { err, fromZod, guard, ok, type Result } from "@/shared/errors";
import { transition } from "@/features/learning/machine";
import type {
  LearningLoopEvent,
  TransitionContext,
} from "@/features/learning/types";
import {
  nextViewShape,
  summarizeEffects,
  type LoopView,
} from "@/features/learning/views";
import {
  hydrateCurrentView,
  isUniqueViolation,
  lessonQuestionIds,
  persistTransition,
  priorWrongAttempts,
  progressFor,
  providerConfigured,
  toMachineSession,
  type SessionRow,
} from "./learning-loop-internal";

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

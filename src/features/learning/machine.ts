import {
  LOOP_CONFIG,
  type LearningLoopEvent,
  type LearningLoopSession,
  type LoopEffect,
  type TransitionContext,
  type TransitionError,
  type TransitionResult,
} from "./types";

/**
 * Pure learning-loop state machine (T3 — D17/D23, PLAN §4).
 *
 * transition() never performs I/O: it takes the current session, an event,
 * and a TransitionContext (read-model inputs assembled by the caller) and
 * returns either the next session + effects for the caller to execute, or a
 * typed error (never a throw — PLAN §10 "illegal transitions → typed error →
 * reset offer").
 *
 * The flow per question (PLAN §4):
 *   wrong #1            → EXPLAIN (static "why" from the lesson)
 *   wrong #2..N+1       → AI_RETEACH (cycle 1..N) → variant served → retry
 *   wrong at cycle cap  → PARK (D23) + manager flag, learner advances
 *   correct             → advance (+ weak-concept event if it took retries)
 *
 * Duplicate-event protection is layered: the attempts table's unique
 * idempotency-key index is the hard guarantee; the persistence layer maps
 * that unique-violation to the DUPLICATE_EVENT error code. The machine
 * itself is deterministic and replayable.
 */

const fail = (
  code: TransitionError["code"],
  message: string
): TransitionError => ({ ok: false, code, message });

const now = () => new Date();

/** Advance to the next question, or complete the session when none remain. */
const advance = (
  session: LearningLoopSession,
  ctx: TransitionContext,
  effects: LoopEffect[]
): TransitionResult => {
  if (ctx.nextQuestionId === null) {
    effects.push({ kind: "COMPLETE_SESSION" });
    return {
      ok: true,
      session: {
        ...session,
        status: "COMPLETED",
        activeQuestionId: null,
        step: "QUESTION",
        reteachCycle: 0,
        updatedAt: now(),
      },
      effects,
    };
  }

  return {
    ok: true,
    session: {
      ...session,
      activeQuestionId: ctx.nextQuestionId,
      step: "QUESTION",
      reteachCycle: 0,
      updatedAt: now(),
    },
    effects,
  };
};

export const transition = (
  session: LearningLoopSession,
  event: LearningLoopEvent,
  ctx: TransitionContext
): TransitionResult => {
  /* ── Lifecycle events ── */

  if (event.type === "SESSION_RESUMED") {
    if (session.status === "ABANDONED" || session.status === "ACTIVE") {
      // Resume-safe and idempotent: resuming an active session is a no-op.
      return {
        ok: true,
        session:
          session.status === "ABANDONED"
            ? { ...session, status: "ACTIVE", updatedAt: now() }
            : session,
        effects: [],
      };
    }
    return fail("SESSION_NOT_ACTIVE", "Completed sessions cannot be resumed.");
  }

  if (session.status !== "ACTIVE") {
    return fail(
      "SESSION_NOT_ACTIVE",
      `Session is ${session.status}; only SESSION_RESUMED is accepted.`
    );
  }

  if (event.type === "SESSION_ABANDONED") {
    return {
      ok: true,
      session: { ...session, status: "ABANDONED", updatedAt: now() },
      effects: [],
    };
  }

  /* ── Question-surface events ── */

  if (session.activeQuestionId === null) {
    return fail("ILLEGAL_TRANSITION", "Session has no active question.");
  }

  if (event.questionId !== session.activeQuestionId) {
    return fail(
      "STALE_QUESTION",
      `Event targets question ${event.questionId}, active is ${session.activeQuestionId}.`
    );
  }

  switch (event.type) {
    case "ANSWER_SUBMITTED": {
      if (session.step !== "QUESTION") {
        return fail(
          "ILLEGAL_TRANSITION",
          `Answers are only accepted in the QUESTION step (current: ${session.step}).`
        );
      }

      const effects: LoopEffect[] = [
        {
          kind: "PERSIST_ATTEMPT",
          questionId: event.questionId,
          correct: event.correct,
        },
      ];

      if (event.correct) {
        effects.push({
          kind: "AWARD_POINTS",
          amount: LOOP_CONFIG.POINTS_PER_CORRECT,
        });

        if (ctx.priorWrongAttempts > 0) {
          effects.push({
            kind: "EMIT_WEAK_CONCEPT",
            questionId: event.questionId,
          });
        }

        return advance(session, ctx, effects);
      }

      /* Wrong answer. */

      if (ctx.priorWrongAttempts === 0) {
        // First miss: static explanation, then retry the same question.
        return {
          ok: true,
          session: { ...session, step: "EXPLAIN", updatedAt: now() },
          effects,
        };
      }

      const nextCycle = session.reteachCycle + 1;

      if (nextCycle > LOOP_CONFIG.RETEACH_CYCLE_CAP) {
        // D23 park-and-continue: park, flag the manager, move the learner on.
        // (The CONCEPT_PARKED step value remains available to the player UI
        // for a persisted interstitial; the canonical parked state lives in
        // the parked_concepts table via the PARK_CONCEPT effect.)
        effects.push(
          { kind: "PARK_CONCEPT", questionId: event.questionId },
          { kind: "FLAG_MANAGER", questionId: event.questionId }
        );
        return advance(session, ctx, effects);
      }

      if (!ctx.reteachAvailableToday) {
        // Daily live-reteach budget exhausted: serve from the pre-generated
        // variant bank directly (D7 fallback chain).
        effects.push({
          kind: "SERVE_VARIANT",
          questionId: event.questionId,
          cycle: nextCycle,
        });
        return {
          ok: true,
          session: {
            ...session,
            step: "QUESTION",
            reteachCycle: nextCycle,
            updatedAt: now(),
          },
          effects,
        };
      }

      effects.push({
        kind: "START_RETEACH_STREAM",
        questionId: event.questionId,
        cycle: nextCycle,
      });
      return {
        ok: true,
        session: {
          ...session,
          step: "AI_RETEACH",
          reteachCycle: nextCycle,
          updatedAt: now(),
        },
        effects,
      };
    }

    case "EXPLAIN_ACKNOWLEDGED": {
      if (session.step !== "EXPLAIN") {
        return fail(
          "ILLEGAL_TRANSITION",
          `EXPLAIN_ACKNOWLEDGED requires the EXPLAIN step (current: ${session.step}).`
        );
      }
      return {
        ok: true,
        session: { ...session, step: "QUESTION", updatedAt: now() },
        effects: [],
      };
    }

    case "RETEACH_COMPLETED": {
      if (session.step !== "AI_RETEACH") {
        return fail(
          "ILLEGAL_TRANSITION",
          `RETEACH_COMPLETED requires the AI_RETEACH step (current: ${session.step}).`
        );
      }
      return {
        ok: true,
        session: { ...session, step: "QUESTION", updatedAt: now() },
        effects: [
          {
            kind: "SERVE_VARIANT",
            questionId: event.questionId,
            cycle: session.reteachCycle,
          },
        ],
      };
    }
  }
};

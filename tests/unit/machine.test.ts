import { describe, expect, it } from "vitest";

import { transition } from "@/features/learning/machine";
import {
  LOOP_CONFIG,
  type LearningLoopEvent,
  type LearningLoopSession,
  type TransitionContext,
} from "@/features/learning/types";

/**
 * Exhaustive transition coverage for the learning-loop machine (T3).
 * Every state × event family is exercised, including the D23 park path,
 * resume safety, stale/illegal events, and the daily reteach budget fallback.
 */

const baseSession = (
  overrides: Partial<LearningLoopSession> = {}
): LearningLoopSession => ({
  id: "session-1",
  companyId: "company-1",
  userId: "user-1",
  lessonId: 10,
  contentVersionId: 1,
  status: "ACTIVE",
  activeQuestionId: 100,
  step: "QUESTION",
  reteachCycle: 0,
  startedAt: new Date("2026-06-12T10:00:00Z"),
  updatedAt: new Date("2026-06-12T10:00:00Z"),
  ...overrides,
});

const ctx = (overrides: Partial<TransitionContext> = {}): TransitionContext => ({
  nextQuestionId: 101,
  priorWrongAttempts: 0,
  reteachAvailableToday: true,
  ...overrides,
});

const answer = (correct: boolean, questionId = 100): LearningLoopEvent => ({
  type: "ANSWER_SUBMITTED",
  sessionId: "session-1",
  idempotencyKey: `key-${Math.random()}`,
  questionId,
  optionId: 1,
  correct,
});

const effectKinds = (result: ReturnType<typeof transition>) =>
  result.ok ? result.effects.map((e) => e.kind) : [];

describe("lifecycle", () => {
  it("resumes an ABANDONED session", () => {
    const result = transition(
      baseSession({ status: "ABANDONED" }),
      { type: "SESSION_RESUMED", sessionId: "session-1", idempotencyKey: "r1" },
      ctx()
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.status).toBe("ACTIVE");
    expect(result.session.step).toBe("QUESTION");
  });

  it("resume on an ACTIVE session is an idempotent no-op", () => {
    const session = baseSession();
    const result = transition(
      session,
      { type: "SESSION_RESUMED", sessionId: "session-1", idempotencyKey: "r2" },
      ctx()
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session).toBe(session);
    expect(result.effects).toEqual([]);
  });

  it("rejects resume of a COMPLETED session", () => {
    const result = transition(
      baseSession({ status: "COMPLETED" }),
      { type: "SESSION_RESUMED", sessionId: "session-1", idempotencyKey: "r3" },
      ctx()
    );
    expect(result).toMatchObject({ ok: false, code: "SESSION_NOT_ACTIVE" });
  });

  it("abandons an ACTIVE session", () => {
    const result = transition(
      baseSession(),
      {
        type: "SESSION_ABANDONED",
        sessionId: "session-1",
        idempotencyKey: "a1",
        reason: "IDLE_EXPIRY",
      },
      ctx()
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.status).toBe("ABANDONED");
  });

  it("rejects answers on non-ACTIVE sessions", () => {
    for (const status of ["COMPLETED", "ABANDONED"] as const) {
      const result = transition(baseSession({ status }), answer(true), ctx());
      expect(result).toMatchObject({ ok: false, code: "SESSION_NOT_ACTIVE" });
    }
  });
});

describe("guards", () => {
  it("rejects events for a non-active question (STALE_QUESTION)", () => {
    const result = transition(baseSession(), answer(true, 999), ctx());
    expect(result).toMatchObject({ ok: false, code: "STALE_QUESTION" });
  });

  it("rejects answers outside the QUESTION step", () => {
    for (const step of ["EXPLAIN", "AI_RETEACH"] as const) {
      const result = transition(baseSession({ step }), answer(true), ctx());
      expect(result).toMatchObject({ ok: false, code: "ILLEGAL_TRANSITION" });
    }
  });

  it("rejects events when no question is active", () => {
    const result = transition(
      baseSession({ activeQuestionId: null }),
      answer(true),
      ctx()
    );
    expect(result).toMatchObject({ ok: false, code: "ILLEGAL_TRANSITION" });
  });

  it("never mutates the input session", () => {
    const session = baseSession();
    const frozen = JSON.stringify(session);
    transition(session, answer(false), ctx());
    transition(session, answer(true), ctx());
    expect(JSON.stringify(session)).toBe(frozen);
  });
});

describe("correct answers", () => {
  it("first-try correct: persists, awards points, advances, no weak concept", () => {
    const result = transition(baseSession(), answer(true), ctx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(effectKinds(result)).toEqual(["PERSIST_ATTEMPT", "AWARD_POINTS"]);
    expect(result.session.activeQuestionId).toBe(101);
    expect(result.session.step).toBe("QUESTION");
    expect(result.session.reteachCycle).toBe(0);

    const award = result.effects.find((e) => e.kind === "AWARD_POINTS");
    expect(award).toMatchObject({ amount: LOOP_CONFIG.POINTS_PER_CORRECT });
  });

  it("correct after retries emits a weak-concept event", () => {
    const result = transition(
      baseSession({ reteachCycle: 1 }),
      answer(true),
      ctx({ priorWrongAttempts: 2 })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(effectKinds(result)).toContain("EMIT_WEAK_CONCEPT");
  });

  it("correct on the final question completes the session", () => {
    const result = transition(
      baseSession(),
      answer(true),
      ctx({ nextQuestionId: null })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.session.status).toBe("COMPLETED");
    expect(result.session.activeQuestionId).toBeNull();
    expect(effectKinds(result)).toContain("COMPLETE_SESSION");
  });

  it("advancing resets the reteach cycle", () => {
    const result = transition(
      baseSession({ reteachCycle: 2 }),
      answer(true),
      ctx({ priorWrongAttempts: 3 })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.reteachCycle).toBe(0);
  });
});

describe("wrong answers — explain and reteach ladder", () => {
  it("first wrong → EXPLAIN with only the attempt persisted", () => {
    const result = transition(baseSession(), answer(false), ctx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.session.step).toBe("EXPLAIN");
    expect(result.session.reteachCycle).toBe(0);
    expect(effectKinds(result)).toEqual(["PERSIST_ATTEMPT"]);
  });

  it("EXPLAIN_ACKNOWLEDGED returns to QUESTION for the retry", () => {
    const result = transition(
      baseSession({ step: "EXPLAIN" }),
      {
        type: "EXPLAIN_ACKNOWLEDGED",
        sessionId: "session-1",
        idempotencyKey: "e1",
        questionId: 100,
      },
      ctx()
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.step).toBe("QUESTION");
  });

  it("EXPLAIN_ACKNOWLEDGED outside EXPLAIN is illegal", () => {
    const result = transition(
      baseSession({ step: "QUESTION" }),
      {
        type: "EXPLAIN_ACKNOWLEDGED",
        sessionId: "session-1",
        idempotencyKey: "e2",
        questionId: 100,
      },
      ctx()
    );
    expect(result).toMatchObject({ ok: false, code: "ILLEGAL_TRANSITION" });
  });

  it("second wrong → AI_RETEACH cycle 1 with a stream effect", () => {
    const result = transition(
      baseSession(),
      answer(false),
      ctx({ priorWrongAttempts: 1 })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.session.step).toBe("AI_RETEACH");
    expect(result.session.reteachCycle).toBe(1);
    expect(effectKinds(result)).toEqual([
      "PERSIST_ATTEMPT",
      "START_RETEACH_STREAM",
    ]);
  });

  it("RETEACH_COMPLETED serves a variant and returns to QUESTION", () => {
    const result = transition(
      baseSession({ step: "AI_RETEACH", reteachCycle: 1 }),
      {
        type: "RETEACH_COMPLETED",
        sessionId: "session-1",
        idempotencyKey: "rc1",
        questionId: 100,
        source: "LIVE_STREAM",
      },
      ctx()
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.session.step).toBe("QUESTION");
    expect(result.effects).toEqual([
      { kind: "SERVE_VARIANT", questionId: 100, cycle: 1 },
    ]);
  });

  it("RETEACH_COMPLETED outside AI_RETEACH is illegal", () => {
    const result = transition(
      baseSession({ step: "QUESTION" }),
      {
        type: "RETEACH_COMPLETED",
        sessionId: "session-1",
        idempotencyKey: "rc2",
        questionId: 100,
        source: "LIVE_STREAM",
      },
      ctx()
    );
    expect(result).toMatchObject({ ok: false, code: "ILLEGAL_TRANSITION" });
  });

  it("daily reteach budget exhausted → variant served directly, no AI step", () => {
    const result = transition(
      baseSession(),
      answer(false),
      ctx({ priorWrongAttempts: 1, reteachAvailableToday: false })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.session.step).toBe("QUESTION");
    expect(result.session.reteachCycle).toBe(1);
    expect(effectKinds(result)).toEqual(["PERSIST_ATTEMPT", "SERVE_VARIANT"]);
  });
});

describe("D23 park-and-continue", () => {
  const atCap = () =>
    baseSession({ reteachCycle: LOOP_CONFIG.RETEACH_CYCLE_CAP });

  it("wrong past the cycle cap parks the concept and flags the manager", () => {
    const result = transition(
      atCap(),
      answer(false),
      ctx({ priorWrongAttempts: LOOP_CONFIG.RETEACH_CYCLE_CAP + 1 })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(effectKinds(result)).toEqual([
      "PERSIST_ATTEMPT",
      "PARK_CONCEPT",
      "FLAG_MANAGER",
    ]);
    // Park-and-continue: the learner advances.
    expect(result.session.activeQuestionId).toBe(101);
    expect(result.session.step).toBe("QUESTION");
    expect(result.session.reteachCycle).toBe(0);
    expect(result.session.status).toBe("ACTIVE");
  });

  it("parking on the final question completes the session", () => {
    const result = transition(
      atCap(),
      answer(false),
      ctx({
        priorWrongAttempts: LOOP_CONFIG.RETEACH_CYCLE_CAP + 1,
        nextQuestionId: null,
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.session.status).toBe("COMPLETED");
    expect(effectKinds(result)).toEqual([
      "PERSIST_ATTEMPT",
      "PARK_CONCEPT",
      "FLAG_MANAGER",
      "COMPLETE_SESSION",
    ]);
  });

  it("the full ladder: explain → cycles 1..cap → park", () => {
    let session = baseSession();

    // Wrong #1 → EXPLAIN.
    let result = transition(session, answer(false), ctx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.step).toBe("EXPLAIN");

    // Acknowledge, retry.
    result = transition(
      result.session,
      {
        type: "EXPLAIN_ACKNOWLEDGED",
        sessionId: "session-1",
        idempotencyKey: "ladder-e",
        questionId: 100,
      },
      ctx()
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    session = result.session;

    // Wrongs #2..(cap+1) walk cycles 1..cap through AI_RETEACH + variant.
    for (let cycle = 1; cycle <= LOOP_CONFIG.RETEACH_CYCLE_CAP; cycle++) {
      result = transition(
        session,
        answer(false),
        ctx({ priorWrongAttempts: cycle })
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.session.step).toBe("AI_RETEACH");
      expect(result.session.reteachCycle).toBe(cycle);

      result = transition(
        result.session,
        {
          type: "RETEACH_COMPLETED",
          sessionId: "session-1",
          idempotencyKey: `ladder-rc-${cycle}`,
          questionId: 100,
          source: "LIVE_STREAM",
        },
        ctx()
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      session = result.session;
    }

    // Next wrong exceeds the cap → park.
    result = transition(
      session,
      answer(false),
      ctx({ priorWrongAttempts: LOOP_CONFIG.RETEACH_CYCLE_CAP + 1 })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(effectKinds(result)).toContain("PARK_CONCEPT");
  });
});

import { describe, expect, it } from "vitest";

import { transition } from "@/lib/learning-loop/machine";
import type {
  LearningLoopSession,
  TransitionContext,
} from "@/lib/learning-loop/types";
import {
  nextViewShape,
  pickVariantIndex,
  summarizeEffects,
} from "@/lib/learning-loop/views";

/** View-shape mapping (T8): machine transitions → what the player renders. */

const session = (
  overrides: Partial<LearningLoopSession> = {}
): LearningLoopSession => ({
  id: "s1",
  companyId: "c1",
  userId: "u1",
  lessonId: 1,
  contentVersionId: 1,
  status: "ACTIVE",
  activeQuestionId: 10,
  step: "QUESTION",
  reteachCycle: 0,
  startedAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const ctx = (overrides: Partial<TransitionContext> = {}): TransitionContext => ({
  nextQuestionId: 11,
  priorWrongAttempts: 0,
  reteachAvailableToday: true,
  ...overrides,
});

const answer = (correct: boolean) =>
  ({
    type: "ANSWER_SUBMITTED",
    sessionId: "s1",
    idempotencyKey: "k",
    questionId: 10,
    optionId: 1,
    correct,
  }) as const;

const okResult = (
  s: LearningLoopSession,
  e: ReturnType<typeof answer>,
  c: TransitionContext
) => {
  const result = transition(s, e, c);
  if (!result.ok) throw new Error(`expected ok, got ${result.code}`);
  return result;
};

describe("nextViewShape", () => {
  it("correct answer → next QUESTION (original surface)", () => {
    const shape = nextViewShape(okResult(session(), answer(true), ctx()));
    expect(shape).toEqual({ type: "QUESTION", surface: "ORIGINAL", banner: null });
  });

  it("correct on last question → COMPLETE", () => {
    const shape = nextViewShape(
      okResult(session(), answer(true), ctx({ nextQuestionId: null }))
    );
    expect(shape).toMatchObject({ type: "COMPLETE" });
  });

  it("first wrong → EXPLAIN", () => {
    const shape = nextViewShape(okResult(session(), answer(false), ctx()));
    expect(shape).toEqual({ type: "EXPLAIN" });
  });

  it("second wrong with provider → RETEACH", () => {
    const shape = nextViewShape(
      okResult(session(), answer(false), ctx({ priorWrongAttempts: 1 }))
    );
    expect(shape).toEqual({ type: "RETEACH" });
  });

  it("second wrong without provider → VARIANT question (D7 fallback)", () => {
    const shape = nextViewShape(
      okResult(
        session(),
        answer(false),
        ctx({ priorWrongAttempts: 1, reteachAvailableToday: false })
      )
    );
    expect(shape).toEqual({ type: "QUESTION", surface: "VARIANT", banner: null });
  });

  it("park-and-continue → next QUESTION with PARKED banner", () => {
    const shape = nextViewShape(
      okResult(
        session({ reteachCycle: 3 }),
        answer(false),
        ctx({ priorWrongAttempts: 4 })
      )
    );
    expect(shape).toEqual({ type: "QUESTION", surface: "ORIGINAL", banner: "PARKED" });
  });

  it("park on final question → COMPLETE with PARKED banner", () => {
    const shape = nextViewShape(
      okResult(
        session({ reteachCycle: 3 }),
        answer(false),
        ctx({ priorWrongAttempts: 4, nextQuestionId: null })
      )
    );
    expect(shape).toEqual({ type: "COMPLETE", banner: "PARKED" });
  });
});

describe("summarizeEffects", () => {
  it("aggregates points and flags", () => {
    const result = okResult(
      session({ reteachCycle: 1 }),
      answer(true),
      ctx({ priorWrongAttempts: 2 })
    );
    const summary = summarizeEffects(result.effects);
    expect(summary.persistAttempt).toBe(true);
    expect(summary.pointsAwarded).toBeGreaterThan(0);
    expect(summary.weakConcept).toBe(true);
    expect(summary.parked).toBe(false);
  });
});

describe("pickVariantIndex", () => {
  it("is deterministic and in range", () => {
    const a = pickVariantIndex(3, 42, 1);
    const b = pickVariantIndex(3, 42, 1);
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(3);
  });

  it("returns -1 for an empty bank", () => {
    expect(pickVariantIndex(0, 42, 1)).toBe(-1);
  });

  it("varies by cycle (retries get a different surface)", () => {
    const indices = new Set(
      [1, 2, 3].map((cycle) => pickVariantIndex(3, 42, cycle))
    );
    expect(indices.size).toBeGreaterThan(1);
  });
});

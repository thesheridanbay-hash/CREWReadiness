import { describe, expect, it } from "vitest";

import {
  DECAY,
  isStale,
  needsRetraining,
  selectDecayedConcepts,
} from "@/features/learning/decay";

/** Memory-loop decay triggers (P5 — D13). */

describe("needsRetraining", () => {
  it("flags a high miss rate once there are enough attempts", () => {
    expect(needsRetraining({ questionId: 1, attempts: 10, wrong: 5 })).toBe(true);
  });

  it("ignores high miss rates below the attempt floor (noise)", () => {
    // 2/2 = 100% miss but only 2 attempts — not yet meaningful.
    expect(needsRetraining({ questionId: 1, attempts: 2, wrong: 2 })).toBe(false);
  });

  it("does not flag a healthy concept", () => {
    expect(needsRetraining({ questionId: 1, attempts: 20, wrong: 2 })).toBe(false);
  });

  it("uses the configured threshold exactly", () => {
    const atThreshold = {
      questionId: 1,
      attempts: 10,
      wrong: Math.ceil((DECAY.RETRAIN_MISS_RATE / 100) * 10),
    };
    expect(needsRetraining(atThreshold)).toBe(true);
  });

  it("selectDecayedConcepts returns only the decayed ones", () => {
    const decayed = selectDecayedConcepts([
      { questionId: 1, attempts: 10, wrong: 6 }, // 60% → flag
      { questionId: 2, attempts: 10, wrong: 1 }, // 10% → keep
      { questionId: 3, attempts: 3, wrong: 3 }, // too few attempts
    ]);
    expect(decayed.map((c) => c.questionId)).toEqual([1]);
  });
});

describe("isStale", () => {
  const now = new Date("2026-06-12T00:00:00Z");

  it("flags content older than the stale window", () => {
    const old = new Date(now.getTime() - (DECAY.STALE_DAYS + 1) * 86_400_000);
    expect(isStale(old, now)).toBe(true);
  });

  it("keeps recently-published content", () => {
    const recent = new Date(now.getTime() - 10 * 86_400_000);
    expect(isStale(recent, now)).toBe(false);
  });

  it("treats never-published content as not stale", () => {
    expect(isStale(null, now)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import {
  assembleCourseDraft,
  lessonSlotsFor,
  mapWithConcurrency,
  sumUsage,
} from "@/features/ai/course-generation";
import {
  courseDraftSchema,
  type CourseSkeleton,
  type LessonContent,
} from "@/features/ai/types";

/**
 * Chunked course generation (truncation fix). The gateway builds a course as a
 * titles-only skeleton plus one body per lesson, then reassembles. These tests
 * pin the non-AI glue: a course always reassembles into a valid
 * courseDraftSchema, bodies map back by POSITION (never by model-echoed ref),
 * and the lesson fan-out is order-preserving + concurrency-bounded.
 */

const skeleton: CourseSkeleton = {
  courseTitle: "Tree Work Safety",
  courseIconPrompt: "a friendly hard-hat mascot",
  modules: [
    {
      ref: "M1",
      title: "Before the cut",
      units: [
        {
          ref: "U1",
          title: "Site checks",
          lessons: [
            { ref: "L1", title: "Spotting hazards" },
            { ref: "L2", title: "Drop zones" },
          ],
        },
      ],
    },
    {
      ref: "M2",
      title: "Climbing",
      units: [
        {
          ref: "U2",
          title: "Gear",
          lessons: [{ ref: "L3", title: "Harness checks" }],
        },
      ],
    },
  ],
};

const bodyFor = (title: string): LessonContent => ({
  teachingText: `Intro to ${title}.\n\n**Key points**\n- be careful`,
  assets: [{ ref: "A1", kind: "illustration", prompt: `diagram for ${title}` }],
  questions: [
    {
      question: `What matters most in "${title}"?`,
      explanation: "Because safety.",
      options: [
        { text: "Plan first", correct: true },
        { text: "Rush in", correct: false },
      ],
    },
  ],
});

describe("lessonSlotsFor", () => {
  it("flattens every lesson with its position and titles, in order", () => {
    const slots = lessonSlotsFor(skeleton);
    expect(slots).toHaveLength(3);
    expect(slots.map((s) => s.lessonTitle)).toEqual([
      "Spotting hazards",
      "Drop zones",
      "Harness checks",
    ]);
    expect(slots[2]).toMatchObject({
      moduleIndex: 1,
      unitIndex: 0,
      lessonIndex: 0,
      moduleTitle: "Climbing",
      unitTitle: "Gear",
    });
  });
});

describe("assembleCourseDraft", () => {
  const bodies = lessonSlotsFor(skeleton).map((slot) => ({
    slot,
    content: bodyFor(slot.lessonTitle),
  }));

  it("reassembles skeleton + bodies into a valid courseDraftSchema", () => {
    const draft = assembleCourseDraft(skeleton, bodies);
    // assembleCourseDraft parses through courseDraftSchema; re-parse to be sure.
    expect(() => courseDraftSchema.parse(draft)).not.toThrow();
    expect(draft.courseTitle).toBe("Tree Work Safety");
    expect(draft.modules).toHaveLength(2);
    expect(draft.modules[0].units[0].lessons[0]).toMatchObject({
      ref: "L1",
      title: "Spotting hazards",
    });
    expect(draft.modules[0].units[0].lessons[0].teachingText).toContain(
      "Spotting hazards"
    );
    expect(draft.modules[1].units[0].lessons[0].title).toBe("Harness checks");
  });

  it("maps bodies by position, not by the order they were generated", () => {
    // Shuffle the bodies (as concurrent generation would) — assembly must still
    // place each body on the correct lesson via its slot, not its array index.
    const shuffled = [bodies[2], bodies[0], bodies[1]];
    const draft = assembleCourseDraft(skeleton, shuffled);
    expect(draft.modules[1].units[0].lessons[0].teachingText).toContain(
      "Harness checks"
    );
    expect(draft.modules[0].units[0].lessons[1].teachingText).toContain(
      "Drop zones"
    );
  });

  it("throws (never ships a gap) if a lesson body is missing", () => {
    const missingOne = bodies.slice(0, 2); // drop L3's body
    expect(() => assembleCourseDraft(skeleton, missingOne)).toThrow(
      /missing body/i
    );
  });
});

describe("sumUsage", () => {
  it("adds tokens and cost across every call", () => {
    const total = sumUsage([
      { inputTokens: 10, outputTokens: 20, costUsd: 0.1 },
      { inputTokens: 5, outputTokens: 7, costUsd: 0.05 },
    ]);
    expect(total.inputTokens).toBe(15);
    expect(total.outputTokens).toBe(27);
    expect(total.costUsd).toBeCloseTo(0.15);
  });

  it("returns zero usage for no calls", () => {
    expect(sumUsage([])).toEqual({ inputTokens: 0, outputTokens: 0, costUsd: 0 });
  });
});

describe("mapWithConcurrency", () => {
  const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("preserves input order in results", async () => {
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      await tick(n % 2 ? 4 : 1); // finish out of order
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50]);
  });

  it("never runs more than `limit` tasks at once", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(
      Array.from({ length: 12 }, (_, i) => i),
      3,
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await tick(3);
        inFlight--;
      }
    );
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1); // actually ran concurrently
  });

  it("rejects fast when any task fails (a failed lesson fails the course)", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("lesson 2 failed");
        await tick(2);
        return n;
      })
    ).rejects.toThrow(/lesson 2 failed/);
  });
});

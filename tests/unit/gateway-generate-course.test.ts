import { beforeEach, describe, expect, it, vi } from "vitest";

import { ZERO_USAGE } from "@/features/ai/types";

/**
 * generateCourse orchestration (truncation fix). The real bug was a single
 * provider call asked to emit the whole course, which truncated. This test
 * pins the new shape: generateCourse makes ONE small skeleton call plus ONE
 * call per lesson (never a single giant call), and reassembles the bodies onto
 * the right lessons. The provider + metering are faked so no network/DB is
 * touched; the live bridge is verified separately.
 */

// --- fakes injected into the gateway's DB-backed dependencies ---
const calls: string[] = [];

const fakeAdapter = {
  name: "fake",
  async generateJson({ prompt }: { prompt: string }) {
    if (prompt.includes("Plan the OUTLINE of a course")) {
      calls.push("skeleton");
      return {
        content: {
          courseTitle: "Tree Work Safety",
          courseIconPrompt: "a hard-hat mascot",
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
        },
        usage: { ...ZERO_USAGE, outputTokens: 100 },
      };
    }

    if (prompt.includes("Write the BODY of ONE lesson")) {
      // Echo the lesson title (from the sandwiched context) so we can assert
      // each body lands on the correct lesson.
      const title = /Lesson:\s*(.+)/.exec(prompt)?.[1]?.trim() ?? "unknown";
      calls.push(`lesson:${title}`);
      return {
        content: {
          teachingText: `Body for ${title}.\n\n**Do this**\n- stay safe`,
          assets: [{ ref: "A1", kind: "illustration", prompt: `art for ${title}` }],
          questions: [
            {
              question: `Key risk in "${title}"?`,
              explanation: "Safety first.",
              options: [
                { text: "Plan ahead", correct: true },
                { text: "Wing it", correct: false },
              ],
            },
          ],
        },
        usage: { ...ZERO_USAGE, outputTokens: 50 },
      };
    }

    throw new Error("unexpected prompt: " + prompt.slice(0, 60));
  },
};

const recordUsage = vi.fn(async () => {});

vi.mock("@/features/ai/provider-resolvers", () => ({
  resolveProvider: vi.fn(async () => ({
    adapter: fakeAdapter,
    providerName: "fake",
    alertThresholdUsd: null,
  })),
}));

vi.mock("@/features/ai/meter", () => ({
  recordUsage: (...args: unknown[]) => recordUsage(...args),
}));

// composeGuidanceFor (internal to the gateway) reads ctx.tx — fake it to return
// no guidance so the composer yields "".
const fakeCtx = {
  tx: {
    execute: async () => ({ rows: [] }),
    query: { companySettings: { findFirst: async () => undefined } },
  },
  companyId: "company-1",
  jobId: "job-1",
} as unknown as import("@/features/ai/types").AiContext;

describe("generateCourse (chunked)", () => {
  beforeEach(() => {
    calls.length = 0;
    recordUsage.mockClear();
  });

  it("makes one skeleton call plus one call per lesson — never a single giant call", async () => {
    const { generateCourse } = await import("@/features/ai/gateway");

    const draft = await generateCourse(fakeCtx, {
      brief: { title: "Tree Work Safety" },
      userBrief: "Crews must be trained before cutting.",
    });

    // 1 skeleton + 3 lessons = 4 small calls (the regression: it chunks).
    expect(calls.filter((c) => c === "skeleton")).toHaveLength(1);
    expect(calls.filter((c) => c.startsWith("lesson:"))).toHaveLength(3);
    expect(calls).toContain("lesson:Spotting hazards");
    expect(calls).toContain("lesson:Harness checks");
  });

  it("reassembles bodies onto the correct lessons and returns a valid draft", async () => {
    const { generateCourse } = await import("@/features/ai/gateway");

    const draft = await generateCourse(fakeCtx, {
      brief: {},
      userBrief: "tree work",
    });

    expect(draft.courseTitle).toBe("Tree Work Safety");
    expect(draft.modules).toHaveLength(2);
    // L2 "Drop zones" body must land on module 0 / unit 0 / lesson 1.
    expect(draft.modules[0].units[0].lessons[1].title).toBe("Drop zones");
    expect(draft.modules[0].units[0].lessons[1].teachingText).toContain(
      "Drop zones"
    );
    // L3 "Harness checks" must land on module 1.
    expect(draft.modules[1].units[0].lessons[0].teachingText).toContain(
      "Harness checks"
    );
  });

  it("meters the whole course once (summed usage), not per call", async () => {
    const { generateCourse } = await import("@/features/ai/gateway");

    await generateCourse(fakeCtx, { brief: {}, userBrief: "tree work" });

    expect(recordUsage).toHaveBeenCalledTimes(1);
    const usageArg = recordUsage.mock.calls[0][3] as { outputTokens: number };
    // skeleton 100 + 3 lessons * 50 = 250
    expect(usageArg.outputTokens).toBe(250);
  });
});

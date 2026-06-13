import { describe, expect, it } from "vitest";

import { courseDraftSchema } from "@/features/ai/types";

/**
 * courseDraftSchema is the trust boundary for AI Course Builder output — it's
 * stored in jsonb and later materialized into real content, so the bounds and
 * the one-correct-answer invariant must hold before anything is persisted.
 */

const lesson = (over: Record<string, unknown> = {}) => ({
  ref: "L1",
  title: "Trimmer safety",
  teachingText: "Keep two hands on the trimmer.",
  assets: [{ ref: "A1", kind: "illustration", prompt: "two hands on a trimmer" }],
  questions: [
    {
      question: "Where do your hands go?",
      explanation: "Two hands keeps the head controlled.",
      options: [
        { text: "Two hands", correct: true },
        { text: "One hand", correct: false },
      ],
    },
  ],
  ...over,
});

const draft = (over: Record<string, unknown> = {}) => ({
  courseTitle: "Equipment Basics",
  courseIconPrompt: "a friendly lawnmower mascot",
  modules: [
    {
      ref: "M1",
      title: "Hand tools",
      units: [{ ref: "U1", title: "Trimmers", lessons: [lesson()] }],
    },
  ],
  ...over,
});

describe("courseDraftSchema", () => {
  it("accepts a well-formed rich draft", () => {
    const parsed = courseDraftSchema.safeParse(draft());
    expect(parsed.success).toBe(true);
  });

  it("tolerates the model's arbitrary ref formats (renumbered on ingest)", () => {
    const weird = draft({
      modules: [
        {
          ref: "module-one",
          title: "Hand tools",
          units: [
            { ref: "unit_1", title: "Trimmers", lessons: [lesson({ ref: "🌱" })] },
          ],
        },
      ],
    });
    expect(courseDraftSchema.safeParse(weird).success).toBe(true);
  });

  it("defaults assets to an empty array when omitted", () => {
    const noAssets = lesson();
    delete (noAssets as Record<string, unknown>).assets;
    const parsed = courseDraftSchema.safeParse(
      draft({
        modules: [
          {
            ref: "M1",
            title: "Hand tools",
            units: [{ ref: "U1", title: "Trimmers", lessons: [noAssets] }],
          },
        ],
      })
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.modules[0].units[0].lessons[0].assets).toEqual([]);
    }
  });

  it("rejects more than 4 assets on a lesson", () => {
    const fiveAssets = lesson({
      assets: Array.from({ length: 5 }, (_, i) => ({
        ref: `A${i}`,
        kind: "illustration",
        prompt: "x",
      })),
    });
    const parsed = courseDraftSchema.safeParse(
      draft({
        modules: [
          {
            ref: "M1",
            title: "Hand tools",
            units: [{ ref: "U1", title: "Trimmers", lessons: [fiveAssets] }],
          },
        ],
      })
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects a question without exactly one correct option", () => {
    const twoCorrect = lesson({
      questions: [
        {
          question: "q",
          explanation: "e",
          options: [
            { text: "a", correct: true },
            { text: "b", correct: true },
          ],
        },
      ],
    });
    const parsed = courseDraftSchema.safeParse(
      draft({
        modules: [
          {
            ref: "M1",
            title: "Hand tools",
            units: [{ ref: "U1", title: "Trimmers", lessons: [twoCorrect] }],
          },
        ],
      })
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects an empty course (no modules)", () => {
    expect(courseDraftSchema.safeParse(draft({ modules: [] })).success).toBe(false);
  });
});

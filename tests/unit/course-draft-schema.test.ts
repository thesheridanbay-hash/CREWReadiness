import { describe, expect, it } from "vitest";

import { courseDraftSchema, lessonItemDraftSchema } from "@/features/ai/types";

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

  it("defaults anatomy to an empty array when omitted (back-compat)", () => {
    const parsed = courseDraftSchema.safeParse(draft());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.modules[0].units[0].lessons[0].anatomy).toEqual([]);
    }
  });

  it("accepts a lesson with ordered anatomy items", () => {
    const withAnatomy = courseDraftSchema.safeParse(
      draft({
        modules: [
          {
            ref: "M1",
            title: "Hand tools",
            units: [
              {
                ref: "U1",
                title: "Trimmers",
                lessons: [
                  lesson({
                    anatomy: [
                      { kind: "teaching", markdown: "Read this." },
                      {
                        kind: "image_pair",
                        caption: "Compare",
                        wrongPrompt: "wrong grip",
                        rightPrompt: "right grip",
                      },
                    ],
                  }),
                ],
              },
            ],
          },
        ],
      })
    );
    expect(withAnatomy.success).toBe(true);
  });

  it("rejects more than 8 anatomy items on a lesson", () => {
    const tooMany = lesson({
      anatomy: Array.from({ length: 9 }, () => ({
        kind: "teaching" as const,
        markdown: "x",
      })),
    });
    const parsed = courseDraftSchema.safeParse(
      draft({
        modules: [
          {
            ref: "M1",
            title: "Hand tools",
            units: [{ ref: "U1", title: "Trimmers", lessons: [tooMany] }],
          },
        ],
      })
    );
    expect(parsed.success).toBe(false);
  });
});

describe("lessonItemDraftSchema", () => {
  it("accepts each kind", () => {
    expect(lessonItemDraftSchema.safeParse({ kind: "teaching", markdown: "x" }).success).toBe(true);
    expect(
      lessonItemDraftSchema.safeParse({ kind: "narrative", text: "x", hook: "y" }).success
    ).toBe(true);
    expect(
      lessonItemDraftSchema.safeParse({ kind: "voice_note", transcript: "x" }).success
    ).toBe(true);
    expect(
      lessonItemDraftSchema.safeParse({
        kind: "image_pair",
        caption: "c",
        wrongPrompt: "w",
        rightPrompt: "r",
      }).success
    ).toBe(true);
  });

  it("requires both prompts on an image_pair", () => {
    expect(
      lessonItemDraftSchema.safeParse({ kind: "image_pair", caption: "c", wrongPrompt: "w" })
        .success
    ).toBe(false);
  });

  it("rejects an unknown kind", () => {
    expect(lessonItemDraftSchema.safeParse({ kind: "video", url: "x" }).success).toBe(false);
  });

  it("defaults a narrative hook to empty", () => {
    const parsed = lessonItemDraftSchema.safeParse({ kind: "narrative", text: "x" });
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.kind === "narrative") {
      expect(parsed.data.hook).toBe("");
    }
  });
});

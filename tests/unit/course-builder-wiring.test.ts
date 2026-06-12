import { describe, expect, it } from "vitest";

import { courseBuilderInputSchema } from "@/lib/content/course-builder-schema";
import { classifyDraft, courseDraftCounts } from "@/lib/content/draft-kind";

/**
 * The approve path and review list both rely on classifyDraft to tell a rich
 * course draft from a flat lesson draft — getting that wrong would route a
 * course into the lesson materializer (or vice versa). The generation input
 * guard stops empty-brief jobs.
 */

const lessonDraft = {
  title: "Mowing safety",
  lessons: [
    {
      title: "Slopes",
      questions: [
        {
          question: "Which way across a slope?",
          explanation: "Across, not up/down, to avoid rollovers.",
          options: [
            { text: "Across", correct: true },
            { text: "Up and down", correct: false },
          ],
        },
      ],
    },
  ],
};

const courseDraft = {
  courseTitle: "Equipment Basics",
  courseIconPrompt: "a friendly mower mascot",
  modules: [
    {
      ref: "M1",
      title: "Hand tools",
      units: [
        {
          ref: "U1",
          title: "Trimmers",
          lessons: [
            {
              ref: "L1",
              title: "Grip",
              teachingText: "Two hands on the trimmer.",
              assets: [],
              questions: [
                {
                  question: "Hands?",
                  explanation: "Two hands.",
                  options: [
                    { text: "Two", correct: true },
                    { text: "One", correct: false },
                  ],
                },
                {
                  question: "Eyes?",
                  explanation: "Wear protection.",
                  options: [
                    { text: "Goggles", correct: true },
                    { text: "Nothing", correct: false },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe("classifyDraft", () => {
  it("identifies a rich course draft", () => {
    const result = classifyDraft(courseDraft);
    expect(result.kind).toBe("course");
  });

  it("identifies a flat lesson draft", () => {
    const result = classifyDraft(lessonDraft);
    expect(result.kind).toBe("lesson");
  });

  it("does not confuse the two shapes for each other", () => {
    // A course draft must never parse as a lesson (would misroute on approve).
    expect(classifyDraft(courseDraft).kind).not.toBe("lesson");
    expect(classifyDraft(lessonDraft).kind).not.toBe("course");
  });

  it("returns unknown for garbage", () => {
    expect(classifyDraft({ foo: 1 }).kind).toBe("unknown");
    expect(classifyDraft(null).kind).toBe("unknown");
  });
});

describe("courseDraftCounts", () => {
  it("totals lessons and questions across the tree", () => {
    const parsed = classifyDraft(courseDraft);
    if (parsed.kind !== "course") throw new Error("expected course");
    expect(courseDraftCounts(parsed.course)).toEqual({
      lessonCount: 1,
      questionCount: 2,
    });
  });
});

describe("courseBuilderInputSchema", () => {
  it("rejects an empty brief (nothing to generate from)", () => {
    expect(courseBuilderInputSchema.safeParse({}).success).toBe(false);
    expect(
      courseBuilderInputSchema.safeParse({ unitCount: 3 }).success
    ).toBe(false);
  });

  it("accepts a free-text idea alone", () => {
    expect(
      courseBuilderInputSchema.safeParse({ userBrief: "ladder safety for crews" })
        .success
    ).toBe(true);
  });

  it("accepts a title or topics alone", () => {
    expect(courseBuilderInputSchema.safeParse({ title: "Chainsaw 101" }).success).toBe(true);
    expect(courseBuilderInputSchema.safeParse({ topics: "PPE, fueling" }).success).toBe(true);
  });
});

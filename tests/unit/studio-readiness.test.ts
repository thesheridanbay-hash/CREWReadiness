import { describe, expect, it } from "vitest";

import {
  courseCompleteness,
  flattenLessons,
  lessonReadiness,
} from "@/app/(main)/studio/[courseId]/studio-readiness";
import type {
  EditorCourse,
  EditorLesson,
  EditorLessonImage,
} from "@/app/(main)/studio/[courseId]/studio-editor-types";

/**
 * The studio workspace's header meter, outline glyphs, and inspector checklist
 * all derive from these pure helpers — so a wrong answer here is visible in
 * three places. The image/voice state precedence (a FAILED asset must surface
 * over a partially-GENERATED set) is the load-bearing rule.
 */

type ImgStatus = EditorLessonImage["status"];

const img = (status: ImgStatus): EditorLessonImage => ({
  id: `img-${status}-${Math.round(status.length)}`,
  ref: "A1",
  kind: "ILLUSTRATION",
  status,
  src: status === "GENERATED" ? "/api/media/x" : null,
  prompt: "p",
});

const lesson = (over: Partial<EditorLesson> = {}): EditorLesson => ({
  id: 1,
  title: "L",
  teachingText: null,
  images: [],
  audio: null,
  items: [],
  questions: [],
  ...over,
});

const question = (id: number) => ({
  id,
  question: "q",
  type: "SELECT" as const,
  explanation: null,
  options: [],
});

describe("lessonReadiness", () => {
  it("is ready only with teaching content AND at least one question", () => {
    expect(lessonReadiness(lesson()).ready).toBe(false);
    expect(
      lessonReadiness(lesson({ teachingText: "hi" })).ready // teaching, no question
    ).toBe(false);
    expect(
      lessonReadiness(lesson({ questions: [question(1)] })).ready // question, no teaching
    ).toBe(false);
    expect(
      lessonReadiness(
        lesson({ teachingText: "hi", questions: [question(1)] })
      ).ready
    ).toBe(true);
  });

  it("counts a teaching/narrative anatomy item as teaching content", () => {
    const r = lessonReadiness(
      lesson({
        items: [{ id: 1, kind: "teaching", order: 1, payload: {} }],
        questions: [question(1)],
      })
    );
    expect(r.hasTeaching).toBe(true);
    expect(r.ready).toBe(true);
  });

  it("treats blank/whitespace teachingText as no teaching", () => {
    expect(lessonReadiness(lesson({ teachingText: "   " })).hasTeaching).toBe(false);
  });

  it("surfaces a FAILED image over a partially-generated set (regression)", () => {
    // The bug: GENERATED was checked before FAILED, masking failures.
    expect(
      lessonReadiness(lesson({ images: [img("GENERATED"), img("FAILED")] })).imageState
    ).toBe("failed");
  });

  it("maps image states by precedence: in-flight > failed > ready > none", () => {
    expect(lessonReadiness(lesson({ images: [] })).imageState).toBe("none");
    expect(
      lessonReadiness(lesson({ images: [img("GENERATED"), img("GENERATED")] })).imageState
    ).toBe("ready");
    expect(
      lessonReadiness(lesson({ images: [img("GENERATED"), img("PENDING")] })).imageState
    ).toBe("pending");
    expect(
      lessonReadiness(
        lesson({ images: [img("FAILED"), img("PENDING")] })
      ).imageState
    ).toBe("pending"); // in-flight wins while anything is still generating
    expect(lessonReadiness(lesson({ images: [img("FAILED")] })).imageState).toBe("failed");
  });

  it("maps voiceover state from the single audio asset", () => {
    expect(lessonReadiness(lesson()).voiceState).toBe("none");
    expect(
      lessonReadiness(lesson({ audio: { id: "a", status: "GENERATED", src: "/x" } }))
        .voiceState
    ).toBe("ready");
    expect(
      lessonReadiness(lesson({ audio: { id: "a", status: "FAILED", src: null } }))
        .voiceState
    ).toBe("failed");
    expect(
      lessonReadiness(lesson({ audio: { id: "a", status: "GENERATING", src: null } }))
        .voiceState
    ).toBe("pending");
  });
});

const course = (lessons: EditorLesson[]): EditorCourse => ({
  id: 10,
  title: "C",
  published: false,
  modules: [
    {
      id: 1,
      title: "M1",
      units: [{ id: 1, title: "U1", lessons }],
    },
  ],
});

describe("flattenLessons + courseCompleteness", () => {
  it("flattens in tree order with breadcrumb context", () => {
    const flat = flattenLessons(course([lesson({ id: 1 }), lesson({ id: 2 })]));
    expect(flat.map((f) => f.lesson.id)).toEqual([1, 2]);
    expect(flat[0].moduleTitle).toBe("M1");
    expect(flat[0].unitTitle).toBe("U1");
  });

  it("counts ready lessons over total", () => {
    const ready = lesson({ id: 1, teachingText: "x", questions: [question(1)] });
    const notReady = lesson({ id: 2 });
    expect(courseCompleteness(course([ready, notReady]))).toEqual({ total: 2, ready: 1 });
  });

  it("reports 0/0 for an empty course (no divide-by-zero)", () => {
    expect(courseCompleteness({ id: 1, title: "C", published: false, modules: [] })).toEqual({
      total: 0,
      ready: 0,
    });
  });
});

import { courseDraftSchema, lessonDraftSchema } from "@/features/ai/types";
import type { CourseDraft, LessonDraft } from "@/features/ai/types";

/**
 * The review queue holds two draft shapes (AI Course Builder): flat lesson
 * drafts (text/voice/photo pipelines) and rich course drafts (the course
 * builder). They are structurally disjoint — a lesson draft has top-level
 * `title` + `lessons`; a course draft has `courseTitle` + `modules` — so this
 * classifier is unambiguous regardless of order. Pure: shared by the approve
 * action and the review list so both agree on what a row is.
 */

export type ClassifiedDraft =
  | { kind: "course"; course: CourseDraft }
  | { kind: "lesson"; lesson: LessonDraft }
  | { kind: "unknown" };

export const classifyDraft = (raw: unknown): ClassifiedDraft => {
  const course = courseDraftSchema.safeParse(raw);
  if (course.success) return { kind: "course", course: course.data };

  const lesson = lessonDraftSchema.safeParse(raw);
  if (lesson.success) return { kind: "lesson", lesson: lesson.data };

  return { kind: "unknown" };
};

/** Total lessons + questions across a course draft (for review summaries). */
export const courseDraftCounts = (
  course: CourseDraft
): { lessonCount: number; questionCount: number } => {
  let lessonCount = 0;
  let questionCount = 0;
  for (const mod of course.modules) {
    for (const unit of mod.units) {
      for (const lesson of unit.lessons) {
        lessonCount += 1;
        questionCount += lesson.questions.length;
      }
    }
  }
  return { lessonCount, questionCount };
};

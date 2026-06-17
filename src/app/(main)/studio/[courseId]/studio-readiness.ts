import type { EditorCourse, EditorLesson } from "./studio-editor-types";

/**
 * Publish-readiness model for the 3-pane studio workspace (T1). Pure functions,
 * shared by the course header (completeness meter), the outline tree (per-lesson
 * status glyph), and the inspector (readiness checklist). No side effects, so
 * every pane derives the same answer from the same `EditorCourse` snapshot.
 */

export type MediaState = "none" | "pending" | "ready" | "failed";

export type LessonReadiness = {
  /** teachingText OR at least one teaching/narrative anatomy item. */
  hasTeaching: boolean;
  questionCount: number;
  imageState: MediaState;
  voiceState: MediaState;
  /** The publish bar: a lesson is "ready" once it teaches something AND quizzes
   * it. Media (images/voiceover) are enhancements, not blockers. */
  ready: boolean;
};

const summarize = (
  statuses: Array<"PENDING" | "GENERATING" | "GENERATED" | "FAILED">
): MediaState => {
  if (statuses.length === 0) return "none";
  // In-flight wins (transient); then surface any failure over partial success;
  // anything left is fully generated.
  if (statuses.some((s) => s === "PENDING" || s === "GENERATING")) return "pending";
  if (statuses.some((s) => s === "FAILED")) return "failed";
  return "ready";
};

export const lessonReadiness = (lesson: EditorLesson): LessonReadiness => {
  const hasTeaching =
    (lesson.teachingText?.trim().length ?? 0) > 0 ||
    lesson.items.some((item) => item.kind === "teaching" || item.kind === "narrative");
  const questionCount = lesson.questions.length;

  return {
    hasTeaching,
    questionCount,
    imageState: summarize(lesson.images.map((image) => image.status)),
    voiceState: lesson.audio ? summarize([lesson.audio.status]) : "none",
    ready: hasTeaching && questionCount >= 1,
  };
};

/** One lesson plus the breadcrumb context the canvas needs to title it. */
export type FlatLesson = {
  lesson: EditorLesson;
  moduleId: number;
  moduleTitle: string;
  unitId: number;
  unitTitle: string;
};

/** Course tree flattened to lessons in display order — the navigation spine. */
export const flattenLessons = (course: EditorCourse): FlatLesson[] => {
  const out: FlatLesson[] = [];
  for (const mod of course.modules) {
    for (const unit of mod.units) {
      for (const lesson of unit.lessons) {
        out.push({
          lesson,
          moduleId: mod.id,
          moduleTitle: mod.title,
          unitId: unit.id,
          unitTitle: unit.title,
        });
      }
    }
  }
  return out;
};

/** Completeness meter numerator/denominator: ready lessons over total lessons. */
export const courseCompleteness = (
  course: EditorCourse
): { total: number; ready: number } => {
  const lessons = flattenLessons(course);
  return {
    total: lessons.length,
    ready: lessons.filter((flat) => lessonReadiness(flat.lesson).ready).length,
  };
};

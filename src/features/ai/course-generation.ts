import {
  courseDraftSchema,
  ZERO_USAGE,
  type CourseDraft,
  type CourseSkeleton,
  type LessonContent,
  type Usage,
} from "./types";

/**
 * Chunked course generation support (truncation fix).
 *
 * generateCourse builds a course in two phases — a titles-only skeleton, then
 * one body per lesson — so no single provider response is large enough to
 * truncate. These pure helpers do the non-AI parts: walking the skeleton into
 * per-lesson work slots, reassembling the bodies back into the rich
 * courseDraftSchema, and bounding how many lesson calls run at once.
 */

/** A lesson to generate, with its position in the skeleton so the body can be
 * merged back deterministically (we map by position, never by model-echoed
 * refs, so ref drift can't misplace content). */
export type LessonSlot = {
  moduleIndex: number;
  unitIndex: number;
  lessonIndex: number;
  moduleTitle: string;
  unitTitle: string;
  lessonTitle: string;
};

/** Flatten a skeleton into the ordered list of lessons whose bodies we must
 * generate. */
export const lessonSlotsFor = (skeleton: CourseSkeleton): LessonSlot[] =>
  skeleton.modules.flatMap((module, moduleIndex) =>
    module.units.flatMap((unit, unitIndex) =>
      unit.lessons.map((lesson, lessonIndex) => ({
        moduleIndex,
        unitIndex,
        lessonIndex,
        moduleTitle: module.title,
        unitTitle: unit.title,
        lessonTitle: lesson.title,
      }))
    )
  );

const slotKey = (s: { moduleIndex: number; unitIndex: number; lessonIndex: number }) =>
  `${s.moduleIndex}:${s.unitIndex}:${s.lessonIndex}`;

/**
 * Merge the skeleton (titles/refs) with each lesson's generated body back into
 * the rich courseDraftSchema. Content is keyed by position; a lesson with no
 * matching body is a programming error (every slot is generated), so we throw
 * rather than emit a half-built course. The result is parsed through
 * courseDraftSchema so the assembled whole is validated exactly like the old
 * single-shot output.
 */
export const assembleCourseDraft = (
  skeleton: CourseSkeleton,
  bodies: Array<{ slot: LessonSlot; content: LessonContent }>
): CourseDraft => {
  const byPosition = new Map<string, LessonContent>();
  for (const { slot, content } of bodies) byPosition.set(slotKey(slot), content);

  const draft = {
    courseTitle: skeleton.courseTitle,
    courseIconPrompt: skeleton.courseIconPrompt,
    modules: skeleton.modules.map((module, moduleIndex) => ({
      ref: module.ref,
      title: module.title,
      units: module.units.map((unit, unitIndex) => ({
        ref: unit.ref,
        title: unit.title,
        lessons: unit.lessons.map((lesson, lessonIndex) => {
          const content = byPosition.get(
            slotKey({ moduleIndex, unitIndex, lessonIndex })
          );
          if (!content) {
            throw new Error(
              `assembleCourseDraft: missing body for lesson ${slotKey({ moduleIndex, unitIndex, lessonIndex })} (${lesson.title})`
            );
          }
          return {
            ref: lesson.ref,
            title: lesson.title,
            teachingText: content.teachingText,
            assets: content.assets,
            questions: content.questions,
          };
        }),
      })),
    })),
  };

  // Validate the reassembled whole; surfaces any shape drift as a clear error.
  return courseDraftSchema.parse(draft);
};

/** Sum token/cost usage across the skeleton + every lesson call so the course
 * still meters as one generateCourse operation. */
export const sumUsage = (usages: Usage[]): Usage =>
  usages.reduce(
    (total, u) => ({
      inputTokens: total.inputTokens + u.inputTokens,
      outputTokens: total.outputTokens + u.outputTokens,
      costUsd: total.costUsd + u.costUsd,
    }),
    { ...ZERO_USAGE }
  );

/**
 * Run `fn` over `items` with at most `limit` in flight at once, preserving
 * input order in the result. Fails fast: the first rejection rejects the whole
 * call (a lesson that can't be generated should fail the course, not ship a
 * gap). `limit` is clamped to [1, items.length].
 */
export const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  const max = Math.max(1, Math.min(limit, items.length));
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: max }, () => worker()));
  return results;
};

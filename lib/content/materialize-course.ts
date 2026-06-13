import {
  courseAssets,
  courses,
  lessons,
  modules,
  questionOptions,
  questions,
  units,
} from "@/db/schema";
import type { ScopedTx } from "@/lib/db/scoped";
import type { CourseDraft } from "@/lib/ai/types";

/**
 * Materialize a rich AI course draft into the content tree (AI Course
 * Builder). Two halves, split so the tricky part is pure and unit-tested:
 *
 *   planCourseMaterialization(draft)  — PURE. Renumbers the model's ad-hoc
 *     refs to stable ones, computes 1-based display order at every level, maps
 *     asset kinds, and builds the SEQUENTIAL asset queue (course ICON at
 *     order 0, then lesson artwork A1..An in tree order). No I/O.
 *
 *   materializeCourseDraft(tx, …)     — thin. Walks the plan and inserts
 *     course → modules → units → lessons (+teachingText) → questions →
 *     options, plus one PENDING course_assets row per planned asset. Every row
 *     carries companyId explicitly (RLS WITH CHECK), and child rows thread the
 *     real parent id from .returning(). Images are NOT generated here — the
 *     PENDING rows are drained one-at-a-time by the PR21 pipeline.
 *
 * The draft is owner-reviewed before this runs (D6); materializing creates
 * DRAFT content (the owner publishes to bump the active version separately).
 */

export type PlannedAsset = {
  ref: string;
  kind: "ICON" | "ILLUSTRATION" | "REALISTIC" | "AUDIO";
  prompt: string;
  order: number;
};

/** Cap the voiceover text so a long lesson doesn't make a runaway audio clip. */
const TTS_MAX_CHARS = 2000;

export type PlannedQuestion = {
  question: string;
  explanation: string;
  order: number;
  options: Array<{ text: string; correct: boolean }>;
};

export type PlannedLesson = {
  title: string;
  teachingText: string;
  order: number;
  questions: PlannedQuestion[];
  /** Lesson artwork (illustration/realistic) — never the course icon. */
  assets: PlannedAsset[];
  /** Voiceover (TTS of the teaching text), if there's text to speak. */
  audio: PlannedAsset | null;
};

export type PlannedUnit = {
  title: string;
  order: number;
  lessons: PlannedLesson[];
};

export type PlannedModule = {
  title: string;
  order: number;
  units: PlannedUnit[];
};

export type CourseMaterializationPlan = {
  courseTitle: string;
  /** order 0, kind ICON, ref "ICON". */
  icon: PlannedAsset;
  modules: PlannedModule[];
  /** Total assets including the icon — what the PR21 queue will drain. */
  assetCount: number;
};

const KIND_MAP: Record<"illustration" | "realistic", "ILLUSTRATION" | "REALISTIC"> =
  {
    illustration: "ILLUSTRATION",
    realistic: "REALISTIC",
  };

/** Pure: turn a validated CourseDraft into a deterministic insertion plan. */
export const planCourseMaterialization = (
  draft: CourseDraft
): CourseMaterializationPlan => {
  // Lesson artwork shares one monotonic counter so refs/order are unique and
  // stable across the whole course (A1, A2, …); the icon owns order 0.
  let assetSeq = 0;

  const modules: PlannedModule[] = draft.modules.map((module, mIdx) => ({
    title: module.title,
    order: mIdx + 1,
    units: module.units.map((unit, uIdx) => ({
      title: unit.title,
      order: uIdx + 1,
      lessons: unit.lessons.map((lesson, lIdx) => {
        const assets: PlannedAsset[] = lesson.assets.map((asset) => {
          assetSeq += 1;
          return {
            ref: `A${assetSeq}`,
            kind: KIND_MAP[asset.kind],
            prompt: asset.prompt,
            order: assetSeq,
          };
        });

        // One voiceover per lesson (TTS of the teaching text), queued after
        // the lesson's images.
        let audio: PlannedAsset | null = null;
        const speech = lesson.teachingText.trim();
        if (speech) {
          assetSeq += 1;
          audio = {
            ref: `V${assetSeq}`,
            kind: "AUDIO",
            prompt: speech.slice(0, TTS_MAX_CHARS),
            order: assetSeq,
          };
        }

        return {
          title: lesson.title,
          teachingText: lesson.teachingText,
          order: lIdx + 1,
          questions: lesson.questions.map((question, qIdx) => ({
            question: question.question,
            explanation: question.explanation,
            order: qIdx + 1,
            options: question.options.map((option) => ({
              text: option.text,
              correct: option.correct,
            })),
          })),
          assets,
          audio,
        };
      }),
    })),
  }));

  return {
    courseTitle: draft.courseTitle,
    icon: { ref: "ICON", kind: "ICON", prompt: draft.courseIconPrompt, order: 0 },
    modules,
    assetCount: assetSeq + 1,
  };
};

export type MaterializeResult = {
  courseId: number;
  moduleCount: number;
  unitCount: number;
  lessonCount: number;
  questionCount: number;
  /** Includes the course icon. */
  assetCount: number;
};

/**
 * Insert the plan as a NEW draft course. Runs inside the caller's scoped
 * transaction (RLS-enforced); the icon row is inserted first so it leads the
 * sequential asset queue.
 */
export const materializeCourseDraft = async (
  tx: ScopedTx,
  companyId: string,
  draft: CourseDraft
): Promise<MaterializeResult> => {
  const plan = planCourseMaterialization(draft);

  const [course] = await tx
    .insert(courses)
    .values({ companyId, title: plan.courseTitle })
    .returning();

  // Course ICON leads the queue (order 0, no lesson).
  await tx.insert(courseAssets).values({
    companyId,
    courseId: course.id,
    lessonId: null,
    ref: plan.icon.ref,
    kind: plan.icon.kind,
    prompt: plan.icon.prompt,
    order: plan.icon.order,
  });

  let moduleCount = 0;
  let unitCount = 0;
  let lessonCount = 0;
  let questionCount = 0;

  for (const plannedModule of plan.modules) {
    const [module] = await tx
      .insert(modules)
      .values({
        companyId,
        courseId: course.id,
        title: plannedModule.title,
        order: plannedModule.order,
      })
      .returning();
    moduleCount += 1;

    for (const plannedUnit of plannedModule.units) {
      const [unit] = await tx
        .insert(units)
        .values({
          companyId,
          moduleId: module.id,
          title: plannedUnit.title,
          order: plannedUnit.order,
        })
        .returning();
      unitCount += 1;

      for (const plannedLesson of plannedUnit.lessons) {
        const [lesson] = await tx
          .insert(lessons)
          .values({
            companyId,
            unitId: unit.id,
            title: plannedLesson.title,
            teachingText: plannedLesson.teachingText,
            order: plannedLesson.order,
          })
          .returning();
        lessonCount += 1;

        for (const plannedQuestion of plannedLesson.questions) {
          const [question] = await tx
            .insert(questions)
            .values({
              companyId,
              lessonId: lesson.id,
              type: "SELECT",
              question: plannedQuestion.question,
              explanation: plannedQuestion.explanation,
              order: plannedQuestion.order,
            })
            .returning();
          questionCount += 1;

          await tx.insert(questionOptions).values(
            plannedQuestion.options.map((option) => ({
              companyId,
              questionId: question.id,
              text: option.text,
              correct: option.correct,
            }))
          );
        }

        const lessonAssets = plannedLesson.audio
          ? [...plannedLesson.assets, plannedLesson.audio]
          : plannedLesson.assets;
        if (lessonAssets.length > 0) {
          await tx.insert(courseAssets).values(
            lessonAssets.map((asset) => ({
              companyId,
              courseId: course.id,
              lessonId: lesson.id,
              ref: asset.ref,
              kind: asset.kind,
              prompt: asset.prompt,
              order: asset.order,
            }))
          );
        }
      }
    }
  }

  return {
    courseId: course.id,
    moduleCount,
    unitCount,
    lessonCount,
    questionCount,
    assetCount: plan.assetCount,
  };
};

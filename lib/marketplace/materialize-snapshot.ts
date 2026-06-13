import {
  courseAssets,
  courses,
  lessonTranslations,
  lessons,
  modules,
  optionTranslations,
  questionOptions,
  questionTranslations,
  questions,
  units,
} from "@/db/schema";
import type { ScopedTx } from "@/shared/db/scoped";

import type { CourseSnapshot } from "./snapshot";

/**
 * Materialize a marketplace SNAPSHOT into the adopting company as a NEW DRAFT
 * course (course marketplace, PR-2). Runs inside the caller's scoped
 * transaction (RLS-enforced), so every row is written under the adopter's
 * tenant context — the adopter never reads the source company's content.
 *
 * Mirrors materializeCourseDraft, but the snapshot is richer:
 *   - Media is SHARED BY REFERENCE: a GENERATED asset (mediaAssetId present)
 *     becomes a GENERATED course_asset pointing at the SAME public blob — no
 *     copy, no regeneration. An ungenerated asset becomes PENDING (the adopter
 *     generates its own later, like normal course creation).
 *   - Translations travel inline and are re-created as translation rows, so an
 *     adopted course arrives multilingual.
 *
 * Refs are renumbered deterministically (ICON, then A1..An in tree order) —
 * the snapshot's own refs are NOT trusted (cross-tenant input), which also
 * guarantees the course_assets (courseId, ref) uniqueness invariant.
 */

export type MaterializeSnapshotResult = {
  courseId: number;
  lessonCount: number;
  questionCount: number;
  sharedAssetCount: number;
  pendingAssetCount: number;
};

export const materializeSnapshot = async (
  tx: ScopedTx,
  companyId: string,
  snapshot: CourseSnapshot
): Promise<MaterializeSnapshotResult> => {
  const iconMediaId = snapshot.icon?.mediaAssetId ?? null;

  const [course] = await tx
    .insert(courses)
    .values({
      companyId,
      title: snapshot.courseTitle,
      // Reference the shared icon blob directly when present.
      imageSrc: iconMediaId ? `/api/media/${iconMediaId}` : "/mascot.svg",
    })
    .returning();

  let sharedAssetCount = 0;
  let pendingAssetCount = 0;
  let lessonCount = 0;
  let questionCount = 0;
  let assetSeq = 0;

  // Course ICON leads the asset queue (order 0).
  if (snapshot.icon) {
    await tx.insert(courseAssets).values({
      companyId,
      courseId: course.id,
      lessonId: null,
      ref: "ICON",
      kind: "ICON",
      prompt: snapshot.icon.prompt ?? snapshot.courseTitle,
      order: 0,
      status: iconMediaId ? "GENERATED" : "PENDING",
      mediaAssetId: iconMediaId,
    });
    if (iconMediaId) sharedAssetCount += 1;
    else pendingAssetCount += 1;
  }

  for (const [mIdx, mod] of snapshot.modules.entries()) {
    const [moduleRow] = await tx
      .insert(modules)
      .values({ companyId, courseId: course.id, title: mod.title, order: mIdx + 1 })
      .returning();

    for (const [uIdx, unit] of mod.units.entries()) {
      const [unitRow] = await tx
        .insert(units)
        .values({ companyId, moduleId: moduleRow.id, title: unit.title, order: uIdx + 1 })
        .returning();

      for (const [lIdx, lesson] of unit.lessons.entries()) {
        const [lessonRow] = await tx
          .insert(lessons)
          .values({
            companyId,
            unitId: unitRow.id,
            title: lesson.title,
            teachingText: lesson.teachingText,
            order: lIdx + 1,
          })
          .returning();
        lessonCount += 1;

        if (lesson.translations.length > 0) {
          await tx.insert(lessonTranslations).values(
            lesson.translations.map((t) => ({
              companyId,
              lessonId: lessonRow.id,
              lang: t.lang,
              title: t.title,
              teachingText: t.teachingText,
            }))
          );
        }

        for (const [qIdx, question] of lesson.questions.entries()) {
          const [questionRow] = await tx
            .insert(questions)
            .values({
              companyId,
              lessonId: lessonRow.id,
              type: question.type,
              question: question.question,
              explanation: question.explanation,
              order: qIdx + 1,
            })
            .returning();
          questionCount += 1;

          if (question.translations.length > 0) {
            await tx.insert(questionTranslations).values(
              question.translations.map((t) => ({
                companyId,
                questionId: questionRow.id,
                lang: t.lang,
                question: t.question,
                explanation: t.explanation,
              }))
            );
          }

          // Options preserve order via insertion order (matches base content).
          for (const option of question.options) {
            const [optionRow] = await tx
              .insert(questionOptions)
              .values({
                companyId,
                questionId: questionRow.id,
                text: option.text,
                correct: option.correct,
              })
              .returning();

            if (option.translations.length > 0) {
              await tx.insert(optionTranslations).values(
                option.translations.map((t) => ({
                  companyId,
                  optionId: optionRow.id,
                  lang: t.lang,
                  text: t.text,
                }))
              );
            }
          }
        }

        // Lesson artwork / voiceover — shared by reference or PENDING.
        for (const asset of lesson.assets) {
          assetSeq += 1;
          const shared = asset.mediaAssetId ?? null;
          await tx.insert(courseAssets).values({
            companyId,
            courseId: course.id,
            lessonId: lessonRow.id,
            ref: `A${assetSeq}`,
            kind: asset.kind,
            prompt: asset.prompt,
            order: assetSeq,
            status: shared ? "GENERATED" : "PENDING",
            mediaAssetId: shared,
          });
          if (shared) sharedAssetCount += 1;
          else pendingAssetCount += 1;
        }
      }
    }
  }

  return {
    courseId: course.id,
    lessonCount,
    questionCount,
    sharedAssetCount,
    pendingAssetCount,
  };
};

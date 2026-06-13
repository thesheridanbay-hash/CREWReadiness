import { and, eq } from "drizzle-orm";

import { courseAssets, courses } from "@/db/schema";
import { DEFAULT_LANGUAGE } from "@/lib/content/languages";
import type { ScopedTx } from "@/shared/db/scoped";
import { AppActionError } from "@/shared/errors";

import { courseSnapshotSchema, type CourseSnapshot } from "./snapshot";

/**
 * Serialize a company's course tree into a marketplace SNAPSHOT (course
 * marketplace, PR-3) — the inverse of materializeSnapshot. Runs inside the
 * publisher's scoped transaction (RLS-enforced).
 *
 * Media is referenced, not copied: a GENERATED asset contributes its
 * mediaAssetId (the publish action then flags those blobs public); everything
 * else travels as a prompt for the adopter to regenerate. Translations are
 * pulled inline. The result is validated against courseSnapshotSchema so a
 * malformed/incomplete course (e.g. a question with one option) is rejected
 * with a clear message BEFORE it ever reaches a listing.
 */

const sharedMedia = (asset: {
  status: string;
  mediaAssetId: string | null;
}): string | null =>
  asset.status === "GENERATED" && asset.mediaAssetId ? asset.mediaAssetId : null;

export const serializeCourse = async (
  tx: ScopedTx,
  courseId: number,
  opts: { category: string; description: string }
): Promise<CourseSnapshot> => {
  const course = await tx.query.courses.findFirst({
    where: eq(courses.id, courseId),
    with: {
      modules: {
        orderBy: (m, { asc }) => [asc(m.order)],
        with: {
          units: {
            orderBy: (u, { asc }) => [asc(u.order)],
            with: {
              lessons: {
                orderBy: (l, { asc }) => [asc(l.order)],
                with: {
                  translations: true,
                  assets: true,
                  questions: {
                    orderBy: (q, { asc }) => [asc(q.order)],
                    with: {
                      translations: true,
                      questionOptions: {
                        orderBy: (o, { asc }) => [asc(o.id)],
                        with: { translations: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!course) throw new AppActionError("not_found", "Course not found.");

  const settings = await tx.query.companySettings.findFirst();
  const primaryLanguage = settings?.primaryLanguage ?? DEFAULT_LANGUAGE;

  const icon = await tx.query.courseAssets.findFirst({
    where: and(
      eq(courseAssets.courseId, courseId),
      eq(courseAssets.kind, "ICON")
    ),
  });

  const built = {
    version: 1,
    courseTitle: course.title,
    category: opts.category,
    description: opts.description,
    primaryLanguage,
    icon: icon
      ? { prompt: icon.prompt, mediaAssetId: sharedMedia(icon) }
      : null,
    modules: course.modules.map((mod) => ({
      title: mod.title,
      units: mod.units.map((unit) => ({
        title: unit.title,
        lessons: unit.lessons.map((lesson) => ({
          title: lesson.title,
          teachingText: lesson.teachingText,
          translations: lesson.translations.map((t) => ({
            lang: t.lang,
            title: t.title,
            teachingText: t.teachingText,
          })),
          assets: lesson.assets
            .filter((asset) => asset.kind !== "ICON")
            .sort((a, b) => a.order - b.order)
            .map((asset) => ({
              ref: asset.ref,
              kind: asset.kind,
              prompt: asset.prompt,
              mediaAssetId: sharedMedia(asset),
            })),
          questions: lesson.questions.map((question) => ({
            question: question.question,
            explanation: question.explanation,
            type: question.type,
            options: question.questionOptions.map((option) => ({
              text: option.text,
              correct: option.correct,
              translations: option.translations.map((t) => ({
                lang: t.lang,
                text: t.text,
              })),
            })),
            translations: question.translations.map((t) => ({
              lang: t.lang,
              question: t.question,
              explanation: t.explanation,
            })),
          })),
        })),
      })),
    })),
  };

  const parsed = courseSnapshotSchema.safeParse(built);
  if (!parsed.success) {
    throw new AppActionError(
      "conflict",
      "This course isn't ready to publish yet — every question needs at least two options, and the course needs at least one lesson."
    );
  }
  return parsed.data;
};

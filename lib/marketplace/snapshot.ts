import { z } from "zod";

/**
 * Course marketplace SNAPSHOT contract (course marketplace).
 *
 * The frozen, portable representation of a course, serialized into a listing
 * at PUBLISH time and materialized into the adopter's company at ADOPT time.
 * It is the ONLY thing that crosses the tenant boundary, so it is validated at
 * both ends (publish output + adopt input) — never trusted raw from jsonb.
 *
 * Media is SHARED BY REFERENCE: a GENERATED asset carries the source's
 * `mediaAssetId` (a public blob), so the adopted course points at the same
 * bytes. A PENDING asset carries only its prompt; the adopter generates its
 * own. Translations travel inline so an adopted course arrives multilingual.
 *
 * `version` pins the format for forward-compatible deserialization.
 */

const lang = z.string().min(2).max(16);
const mediaId = z.string().uuid();

const optionSnapshot = z.object({
  text: z.string().min(1).max(280),
  correct: z.boolean(),
  translations: z
    .array(z.object({ lang, text: z.string().min(1).max(280) }))
    .max(12)
    .default([]),
});

const questionSnapshot = z.object({
  question: z.string().min(1).max(700),
  explanation: z.string().max(1400).nullable().default(null),
  type: z.enum(["SELECT", "ASSIST"]).default("SELECT"),
  options: z.array(optionSnapshot).min(2).max(6),
  translations: z
    .array(
      z.object({
        lang,
        question: z.string().min(1).max(700),
        explanation: z.string().max(1400).nullable().default(null),
      })
    )
    .max(12)
    .default([]),
});

const assetSnapshot = z.object({
  ref: z.string().min(1).max(16),
  kind: z.enum(["ILLUSTRATION", "REALISTIC", "AUDIO"]),
  prompt: z.string().min(1).max(4000),
  /** Shared public blob for a GENERATED asset; null for PENDING (regenerated). */
  mediaAssetId: mediaId.nullable().default(null),
});

const lessonSnapshot = z.object({
  title: z.string().min(1).max(300),
  teachingText: z.string().max(5000).nullable().default(null),
  translations: z
    .array(
      z.object({
        lang,
        title: z.string().max(300).nullable().default(null),
        teachingText: z.string().max(5000).nullable().default(null),
      })
    )
    .max(12)
    .default([]),
  assets: z.array(assetSnapshot).max(8).default([]),
  questions: z.array(questionSnapshot).max(20).default([]),
});

const unitSnapshot = z.object({
  title: z.string().min(1).max(300),
  lessons: z.array(lessonSnapshot).min(1).max(20),
});

const moduleSnapshot = z.object({
  title: z.string().min(1).max(300),
  units: z.array(unitSnapshot).min(1).max(20),
});

export const courseSnapshotSchema = z.object({
  version: z.literal(1),
  courseTitle: z.string().min(1).max(300),
  category: z.string().min(1).max(64),
  description: z.string().max(1000).default(""),
  primaryLanguage: lang,
  /** Course-card icon: shared blob if generated, prompt for regeneration. */
  icon: z
    .object({
      prompt: z.string().max(4000).nullable().default(null),
      mediaAssetId: mediaId.nullable().default(null),
    })
    .nullable()
    .default(null),
  modules: z.array(moduleSnapshot).min(1).max(12),
});

export type CourseSnapshot = z.infer<typeof courseSnapshotSchema>;
export type LessonSnapshot = z.infer<typeof lessonSnapshot>;
export type AssetSnapshot = z.infer<typeof assetSnapshot>;

export type SnapshotStats = {
  modules: number;
  units: number;
  lessons: number;
  questions: number;
  /** Generated assets the adopter will reference (shared blobs). */
  sharedAssets: number;
  /** Ungenerated assets the adopter will generate itself. */
  pendingAssets: number;
  /** Distinct languages present (primary + any translation langs). */
  languages: string[];
};

/** PURE: summarize a snapshot for previews and adopt results. */
export const snapshotStats = (snapshot: CourseSnapshot): SnapshotStats => {
  const stats: SnapshotStats = {
    modules: snapshot.modules.length,
    units: 0,
    lessons: 0,
    questions: 0,
    sharedAssets: 0,
    pendingAssets: 0,
    languages: [],
  };
  const langs = new Set<string>([snapshot.primaryLanguage]);

  const countAsset = (mediaAssetId: string | null) => {
    if (mediaAssetId) stats.sharedAssets += 1;
    else stats.pendingAssets += 1;
  };
  if (snapshot.icon) countAsset(snapshot.icon.mediaAssetId);

  for (const mod of snapshot.modules) {
    for (const unit of mod.units) {
      stats.units += 1;
      for (const lesson of unit.lessons) {
        stats.lessons += 1;
        for (const translation of lesson.translations) langs.add(translation.lang);
        for (const asset of lesson.assets) countAsset(asset.mediaAssetId);
        for (const question of lesson.questions) {
          stats.questions += 1;
          for (const translation of question.translations) langs.add(translation.lang);
          for (const option of question.options) {
            for (const translation of option.translations) langs.add(translation.lang);
          }
        }
      }
    }
  }

  stats.languages = [...langs];
  return stats;
};

/** Collect every shared (referenced) media id in a snapshot — the blobs the
 * adopter will reference and that publish must have flagged public. */
export const snapshotMediaIds = (snapshot: CourseSnapshot): string[] => {
  const ids: string[] = [];
  if (snapshot.icon?.mediaAssetId) ids.push(snapshot.icon.mediaAssetId);
  for (const mod of snapshot.modules) {
    for (const unit of mod.units) {
      for (const lesson of unit.lessons) {
        for (const asset of lesson.assets) {
          if (asset.mediaAssetId) ids.push(asset.mediaAssetId);
        }
      }
    }
  }
  return ids;
};

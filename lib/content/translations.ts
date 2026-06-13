import { and, eq, inArray } from "drizzle-orm";

import {
  lessonTranslations,
  optionTranslations,
  questionTranslations,
  userProgress,
} from "@/db/schema";
import type { ScopedTx } from "@/lib/db/scoped";

import { DEFAULT_LANGUAGE, resolveReadingLanguage } from "./languages";

/**
 * Learner-side translation reads (multi-language courses, PR-C).
 *
 * Base content rows hold the company's PRIMARY language; these helpers overlay
 * the crew member's chosen language on top, falling back to the base whenever a
 * translation row is missing — so a learner NEVER sees a blank. When the
 * resolved reading language IS the primary, `needsOverlay` is false and callers
 * skip the extra lookups entirely.
 */

export type ReadingLanguage = {
  /** The language to render in (always a supported code). */
  lang: string;
  /** The company primary (base-row) language. */
  primary: string;
  /** True only when lang differs from primary — i.e. an overlay is needed. */
  needsOverlay: boolean;
};

/** Resolve the reading language for a user: their pref, else company primary. */
export const getReadingLanguage = async (
  tx: ScopedTx,
  userId: string
): Promise<ReadingLanguage> => {
  const progress = await tx.query.userProgress.findFirst({
    where: eq(userProgress.userId, userId),
    columns: { language: true },
  });
  const settings = await tx.query.companySettings.findFirst({
    columns: { primaryLanguage: true },
  });

  const primary = settings?.primaryLanguage ?? DEFAULT_LANGUAGE;
  const lang = resolveReadingLanguage(progress?.language ?? null, primary);

  return { lang, primary, needsOverlay: lang !== primary };
};

/** Lesson title + teaching text in `lang`, or null when untranslated. */
export const lessonTeachingOverlay = async (
  tx: ScopedTx,
  lessonId: number,
  lang: string
): Promise<{ title: string | null; teachingText: string | null } | null> => {
  const row = await tx.query.lessonTranslations.findFirst({
    where: and(
      eq(lessonTranslations.lessonId, lessonId),
      eq(lessonTranslations.lang, lang)
    ),
    columns: { title: true, teachingText: true },
  });
  return row ?? null;
};

/** Question prompt + explanation in `lang`, or null when untranslated. */
export const questionTextOverlay = async (
  tx: ScopedTx,
  questionId: number,
  lang: string
): Promise<{ question: string; explanation: string | null } | null> => {
  const row = await tx.query.questionTranslations.findFirst({
    where: and(
      eq(questionTranslations.questionId, questionId),
      eq(questionTranslations.lang, lang)
    ),
    columns: { question: true, explanation: true },
  });
  return row ?? null;
};

/** Map of optionId → translated text in `lang` (only the rows that exist). */
export const optionTextOverlay = async (
  tx: ScopedTx,
  optionIds: number[],
  lang: string
): Promise<Map<number, string>> => {
  if (optionIds.length === 0) return new Map();
  const rows = await tx.query.optionTranslations.findMany({
    where: and(
      inArray(optionTranslations.optionId, optionIds),
      eq(optionTranslations.lang, lang)
    ),
    columns: { optionId: true, text: true },
  });
  return new Map(rows.map((row) => [row.optionId, row.text]));
};

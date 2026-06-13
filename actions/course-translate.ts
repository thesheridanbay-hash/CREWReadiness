"use server";

import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { courses } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
} from "@/lib/content/languages";
import { countLessonsInCourse } from "@/lib/content/translate-runner";
import { scoped, type ScopedTx } from "@/lib/db/scoped";
import { AppActionError, fromZod, guard, ok, type Result } from "@/shared/errors";

/**
 * Per-language translation progress for a course (multi-language courses,
 * PR-B). Owner/manager only — powers the editor's "Translate to <language>"
 * control (PR-D). The company primary language is excluded: base rows already
 * ARE that language, so it's always 100% by definition.
 */

const requireOwner = async () => {
  const auth = await getSession();
  if (!auth) throw new AppActionError("unauthorized", "Sign in to continue.");
  if (auth.role === "employee") {
    throw new AppActionError(
      "forbidden",
      "Only owners and managers can manage translations."
    );
  }
  return auth;
};

const courseIdSchema = z.object({ courseId: z.number().int().positive() });

export type CourseLanguageProgress = {
  code: string;
  label: string;
  translated: number;
  total: number;
  complete: boolean;
};

export type CourseTranslationStatus = {
  primaryLanguage: string;
  totalLessons: number;
  languages: CourseLanguageProgress[];
};

const translatedCountsByLang = async (
  tx: ScopedTx,
  courseId: number
): Promise<Map<string, number>> => {
  const result = await tx.execute<{ lang: string; n: number }>(sql`
    SELECT lt.lang, count(*)::int AS n
    FROM lesson_translations lt
    JOIN lessons l ON l.id = lt.lesson_id
    JOIN units u ON u.id = l.unit_id
    JOIN modules m ON m.id = u.module_id
    WHERE m.course_id = ${courseId}
    GROUP BY lt.lang
  `);
  return new Map(result.rows.map((row) => [row.lang, row.n]));
};

export const getCourseTranslationStatus = async (
  input: unknown
): Promise<Result<CourseTranslationStatus>> =>
  guard<CourseTranslationStatus>(async () => {
    const parsed = courseIdSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);

    const auth = await requireOwner();
    const { courseId } = parsed.data;

    return scoped<Result<CourseTranslationStatus>>(auth, async (tx) => {
      const course = await tx.query.courses.findFirst({
        where: eq(courses.id, courseId),
      });
      if (!course) throw new AppActionError("not_found", "Course not found.");

      const settings = await tx.query.companySettings.findFirst();
      const primaryLanguage = settings?.primaryLanguage ?? DEFAULT_LANGUAGE;

      const total = await countLessonsInCourse(tx, courseId);
      const counts = await translatedCountsByLang(tx, courseId);

      const languages: CourseLanguageProgress[] = SUPPORTED_LANGUAGES.filter(
        (language) => language.code !== primaryLanguage
      ).map((language) => {
        const translated = counts.get(language.code) ?? 0;
        return {
          code: language.code,
          label: language.label,
          translated,
          total,
          complete: total > 0 && translated >= total,
        };
      });

      return ok({ primaryLanguage, totalLessons: total, languages });
    });
  });

import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { companySettings, courses } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import {
  DEFAULT_LANGUAGE,
  isSupportedLanguage,
  languageLabel,
} from "@/features/courses/languages";
import {
  countUntranslatedLessons,
  nextUntranslatedLessonId,
  translateLessonInto,
} from "@/features/courses/translate-runner";
import { scoped } from "@/shared/db/scoped";

/**
 * Translate a course's text into one language (multi-language courses, PR-B),
 * synchronously and on demand.
 *
 * Same free-tier strategy as image generation: no background worker. Each call
 * drains as many PENDING lessons as fit under a wall-clock budget (well inside
 * Fluid Compute's 300s cap), then returns how many it did and how many remain
 * so the client loops until done. Per-lesson work is resumable (a refresh or
 * re-click picks up the remaining untranslated lessons) and a single failure
 * stops THIS call cleanly rather than spinning.
 */
export const maxDuration = 300;

/**
 * Stop STARTING new lessons past this. A started lesson can run up to its
 * translateLesson timeout (120s), so the last one started just before the
 * budget finishes by ~150 + 120 = 270s — safely inside the 300s function cap,
 * with headroom for the final writes. (Fast lessons still batch many per call.)
 */
const BUDGET_MS = 150_000;

const bodySchema = z.object({
  courseId: z.number().int().positive(),
  lang: z.string().min(2).max(16),
});

export async function POST(request: NextRequest) {
  const auth = await getSession();
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (auth.role === "employee") {
    return NextResponse.json(
      {
        error: "forbidden",
        message: "Only owners and managers can translate courses.",
      },
      { status: 403 }
    );
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    input = {};
  }
  const parsed = bodySchema.safeParse(input);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", message: "A courseId and lang are required." },
      { status: 400 }
    );
  }
  const { courseId, lang } = parsed.data;

  if (!isSupportedLanguage(lang)) {
    return NextResponse.json(
      { error: "validation", message: `${lang} is not a supported language.` },
      { status: 400 }
    );
  }

  // Resolve the course + the company primary language under tenant RLS.
  const context = await scoped(auth, async (tx) => {
    const course = await tx.query.courses.findFirst({
      where: eq(courses.id, courseId),
    });
    if (!course) return null;
    const settings = await tx.query.companySettings.findFirst({
      where: eq(companySettings.companyId, auth.companyId),
    });
    return { primaryLanguage: settings?.primaryLanguage ?? DEFAULT_LANGUAGE };
  });

  if (!context) {
    return NextResponse.json(
      { error: "not_found", message: "Course not found." },
      { status: 404 }
    );
  }

  // The base rows ARE the primary language — there is nothing to translate.
  if (lang === context.primaryLanguage) {
    return NextResponse.json(
      {
        error: "conflict",
        message: `${languageLabel(lang)} is this company's primary language — content is already in it.`,
      },
      { status: 409 }
    );
  }

  const started = Date.now();
  let translated = 0;
  let failure: { lessonId: number; message: string } | null = null;

  while (Date.now() - started < BUDGET_MS) {
    const lessonId = await scoped(auth, (tx) =>
      nextUntranslatedLessonId(tx, courseId, lang)
    );
    if (lessonId === null) break; // all lessons translated

    try {
      await scoped(auth, (tx) =>
        translateLessonInto(tx, auth.companyId, lessonId, lang)
      );
      translated += 1;
    } catch (error) {
      failure = {
        lessonId,
        message:
          error instanceof Error ? error.message : "Translation failed.",
      };
      break; // stop this call; the client can retry the remaining lessons
    }
  }

  const remaining = await scoped(auth, (tx) =>
    countUntranslatedLessons(tx, courseId, lang)
  );

  return NextResponse.json({
    ok: true,
    lang,
    done: remaining === 0,
    translated,
    remaining,
    failed: failure,
  });
}

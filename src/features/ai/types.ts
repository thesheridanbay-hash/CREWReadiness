import { z } from "zod";

import type { ScopedTx } from "@/shared/db/scoped";

/**
 * AI gateway contracts (T4 — D5/D19). All adapter outputs are zod-validated
 * at the boundary (D15): invalid JSON → one retry → dead-letter (handled by
 * the calling job).
 */

/**
 * Length bounds on every LLM-produced string (review finding: trust
 * boundary): outputs are stored in jsonb and rendered later — unbounded
 * strings are a storage + rendering hazard.
 */
const optionsWithOneCorrect = z
  .array(
    z.object({
      text: z.string().min(1).max(200),
      correct: z.boolean(),
    })
  )
  .min(2)
  .max(6)
  .refine(
    (options) => options.filter((option) => option.correct).length === 1,
    { message: "Exactly one option must be correct." }
  );

export const questionDraftSchema = z.object({
  question: z.string().min(1).max(500),
  /** Static "why" used by the EXPLAIN step (D7). */
  explanation: z.string().min(1).max(1000),
  options: optionsWithOneCorrect,
});

export const lessonDraftSchema = z.object({
  title: z.string().min(1).max(200),
  lessons: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        questions: z.array(questionDraftSchema).min(1).max(10),
      })
    )
    .min(1)
    .max(10),
});

export type LessonDraft = z.infer<typeof lessonDraftSchema>;

export const variantDraftSchema = z.object({
  prompt: z.string().min(1).max(500),
  options: optionsWithOneCorrect,
});

export const variantBatchSchema = z.array(variantDraftSchema).min(1).max(10);

export type VariantDraft = z.infer<typeof variantDraftSchema>;

/* ─────────── Rich course draft (AI Course Builder) ─────────── */

/** Lesson illustration/photo to generate. Refs are permissive: the model may
 * emit M1/U1/A1 etc.; we renumber to stable refs on ingest, so validation
 * never fails on ref-format drift. */
const refString = z.string().min(1).max(16);

export const assetDraftSchema = z.object({
  ref: refString,
  kind: z.enum(["illustration", "realistic"]),
  prompt: z.string().min(1).max(500),
});

export type AssetDraft = z.infer<typeof assetDraftSchema>;

/* ─────────── Lesson-anatomy draft items (Phase 2 generation) ───────────
 * The AI may emit an ordered `anatomy` sequence per lesson — typed teach items
 * shown before the quiz. This is the GENERATION contract (text + image prompts
 * the model produces); media is filled later (owner upload or on-demand AI), so
 * draft image_pair/voice_note carry prompts/transcript, NOT media ids. The
 * stored payload shape lives in features/courses/lesson-item-schema.ts. */
export const lessonItemDraftSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("teaching"),
    markdown: z.string().min(1).max(4000),
  }),
  z.object({
    kind: z.literal("narrative"),
    text: z.string().min(1).max(4000),
    hook: z.string().max(500).default(""),
  }),
  z.object({
    kind: z.literal("voice_note"),
    transcript: z.string().min(1).max(4000),
  }),
  z.object({
    kind: z.literal("image_pair"),
    caption: z.string().max(500).default(""),
    wrongPrompt: z.string().min(1).max(500),
    rightPrompt: z.string().min(1).max(500),
  }),
]);

export type LessonItemDraft = z.infer<typeof lessonItemDraftSchema>;

export const courseDraftSchema = z.object({
  courseTitle: z.string().min(1).max(200),
  /** Prompt for the dynamic course-card icon (req 1). */
  courseIconPrompt: z.string().min(1).max(400),
  modules: z
    .array(
      z.object({
        ref: refString,
        title: z.string().min(1).max(200),
        units: z
          .array(
            z.object({
              ref: refString,
              title: z.string().min(1).max(200),
              lessons: z
                .array(
                  z.object({
                    ref: refString,
                    title: z.string().min(1).max(200),
                    teachingText: z.string().min(1).max(4000),
                    assets: z.array(assetDraftSchema).max(4).default([]),
                    /** Optional ordered teach items (Phase 2). Absent → the
                     * lesson falls back to teachingText (dual-render). */
                    anatomy: z.array(lessonItemDraftSchema).max(8).default([]),
                    questions: z.array(questionDraftSchema).min(1).max(12),
                  })
                )
                .min(1)
                .max(20),
            })
          )
          .min(1)
          .max(20),
      })
    )
    .min(1)
    .max(12),
});

export type CourseDraft = z.infer<typeof courseDraftSchema>;

export const photoAnalysisSchema = z.object({
  /** What the model saw (wrong-way/right-way pairs, hazards, context). */
  observations: z.string().min(1).max(2000),
  draft: lessonDraftSchema,
});

export type PhotoAnalysis = z.infer<typeof photoAnalysisSchema>;

export const transcriptionSchema = z.object({
  text: z.string().min(1),
});

export type AiOperation =
  | "generateLesson"
  | "generateCourse"
  | "reteach"
  | "generateVariants"
  | "analyzePhoto"
  | "transcribeVoice"
  | "generateImage"
  | "generateSpeech"
  | "translateLesson"
  | "translateCourseStructure"
  | "improveText";

/** One improved field (AI-magic per-field editing). Bound generously — markdown
 * teaching text is the longest field. */
export const improvedTextSchema = z.object({
  text: z.string().min(1).max(6000),
});

/* ─────────── Lesson translation (multi-language, PR-B) ─────────── */

/**
 * One lesson's translatable content, pulled from the PRIMARY-language base
 * rows. Options are an ordered string array (ordered by option id) so the
 * translated array maps back to base option ids by index.
 */
export type TranslationSource = {
  title: string;
  teachingText: string | null;
  questions: Array<{
    question: string;
    explanation: string | null;
    options: string[];
  }>;
};

/** Same shape, in the target language — what the model returns. */
export type LessonTranslationResult = TranslationSource;

/**
 * Build the validator for ONE lesson's translation. The shape is fixed, but
 * the COUNTS are pinned to the source: the model must return exactly the same
 * number of questions and per-question options, in order, so we can map the
 * translated strings back onto the base ids by index. A miscount (or a dropped
 * teachingText) fails validation → the gateway's one retry kicks in (D15).
 *
 * Length bounds sit ABOVE the base-content bounds (lib/ai/types question/
 * lesson schemas) because translations legitimately expand (~15-20% for
 * es) — they still cap the LLM trust boundary before the strings are stored
 * and rendered.
 */
export const buildLessonTranslationSchema = (
  source: TranslationSource
): z.ZodType<LessonTranslationResult> =>
  z
    .object({
      title: z.string().min(1).max(300),
      teachingText: z
        .string()
        .max(5000)
        .nullable()
        .optional()
        .transform((value) => value ?? null),
      questions: z.array(
        z.object({
          question: z.string().min(1).max(700),
          explanation: z
            .string()
            .max(1400)
            .nullable()
            .optional()
            .transform((value) => value ?? null),
          options: z.array(z.string().min(1).max(280)).max(8),
        })
      ),
    })
    .superRefine((value, ctx) => {
      if (source.teachingText && !value.teachingText) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "teachingText is required (the source lesson has one).",
          path: ["teachingText"],
        });
      }
      if (value.questions.length !== source.questions.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Expected ${source.questions.length} questions, got ${value.questions.length}.`,
          path: ["questions"],
        });
        return; // per-question option checks would be meaningless misaligned
      }
      source.questions.forEach((question, index) => {
        const got = value.questions[index].options.length;
        if (got !== question.options.length) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Question ${index + 1}: expected ${question.options.length} options, got ${got}.`,
            path: ["questions", index, "options"],
          });
        }
      });
    }) as unknown as z.ZodType<LessonTranslationResult>;

/* ─────────── Course-structure translation (course + unit titles) ─────────── */

/**
 * A course's structure strings (course title + each unit's title/description),
 * units in display order so the translated array maps back to base unit ids by
 * index. Lesson content is handled separately by the per-lesson translator.
 */
export type CourseStructureSource = {
  courseTitle: string;
  units: Array<{ title: string; description: string | null }>;
};

export type CourseStructureTranslationResult = CourseStructureSource;

/** Validator: counts pinned to the source (same number of units, in order) so
 * the index mapping is always aligned; lengths bounded above the base bounds. */
export const buildStructureTranslationSchema = (
  source: CourseStructureSource
): z.ZodType<CourseStructureTranslationResult> =>
  z
    .object({
      courseTitle: z.string().min(1).max(300),
      units: z.array(
        z.object({
          title: z.string().min(1).max(300),
          description: z
            .string()
            .max(1000)
            .nullable()
            .optional()
            .transform((value) => value ?? null),
        })
      ),
    })
    .superRefine((value, ctx) => {
      if (value.units.length !== source.units.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Expected ${source.units.length} units, got ${value.units.length}.`,
          path: ["units"],
        });
      }
    }) as unknown as z.ZodType<CourseStructureTranslationResult>;

/** Result of an image generation: bytes (b64) or a URL, plus content type. */
export type ImageResult = {
  b64?: string;
  url?: string;
  contentType: string;
  usage: Usage;
};

/**
 * Tenant context for every gateway call: metering writes ride the caller's
 * scoped transaction, so usage rows always carry the right companyId (D20).
 */
export type AiContext = {
  tx: ScopedTx;
  companyId: string;
  jobId?: string;
};

export type ProviderName = "openclaw" | "direct";

export type ProviderConfig = {
  provider: ProviderName;
  baseUrl: string;
  model: string;
  apiKey: string;
  alertThresholdUsd: number | null;
};

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

/** Per-operation timeouts (ms). Reteach is tight: timeout → pre-gen variant (D7). */
export const AI_TIMEOUTS: Record<AiOperation, number> = {
  generateLesson: 120_000,
  // Single attempt now (no retry) — give the big call generous headroom under
  // the 300s route cap instead of two short attempts that overrun it.
  generateCourse: 270_000,
  reteach: 8_000,
  generateVariants: 60_000,
  analyzePhoto: 120_000,
  transcribeVoice: 300_000,
  // Image gen (esp. OpenClaw) lands ~120s+; keep well under the 300s route cap
  // so a slow-but-valid image isn't aborted by our own timeout.
  generateImage: 280_000,
  // TTS voiceover via OpenClaw; same generous budget under the 300s route cap.
  generateSpeech: 280_000,
  // One lesson's text translation — comparable to a single lesson generation.
  translateLesson: 120_000,
  // Course title + all unit titles in one call — short strings, modest budget.
  translateCourseStructure: 120_000,
  // Single-field rewrite/format — small + interactive, keep it snappy.
  improveText: 90_000,
};

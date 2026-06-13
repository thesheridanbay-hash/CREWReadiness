import { z } from "zod";

import type { ScopedTx } from "@/lib/db/scoped";

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
  | "generateSpeech";

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
  generateCourse: 180_000,
  reteach: 8_000,
  generateVariants: 60_000,
  analyzePhoto: 120_000,
  transcribeVoice: 300_000,
  // Image gen (esp. OpenClaw) lands ~120s+; keep well under the 300s route cap
  // so a slow-but-valid image isn't aborted by our own timeout.
  generateImage: 280_000,
  // TTS voiceover via OpenClaw; same generous budget under the 300s route cap.
  generateSpeech: 280_000,
};

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
  | "reteach"
  | "generateVariants"
  | "analyzePhoto"
  | "transcribeVoice";

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
  reteach: 8_000,
  generateVariants: 60_000,
  analyzePhoto: 120_000,
  transcribeVoice: 300_000,
};

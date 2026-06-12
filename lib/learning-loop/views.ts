import type { LoopEffect, TransitionOk } from "./types";

/**
 * Loop view layer (T8): the discriminated union the lesson player renders.
 * Pure mapping from machine transitions — no I/O here; the actions layer
 * hydrates content (question text, options, variants) around these shapes.
 */

export type OptionView = {
  /** question_options.id for originals; array index for variants. */
  ref: number;
  text: string;
  imageSrc?: string | null;
  audioSrc?: string | null;
};

export type QuestionSurfaceView =
  | {
      kind: "ORIGINAL";
      questionId: number;
      prompt: string;
      questionType: "SELECT" | "ASSIST";
      options: OptionView[];
    }
  | {
      kind: "VARIANT";
      questionId: number;
      variantId: number;
      prompt: string;
      options: OptionView[];
    };

export type ProgressView = {
  /** Questions in this lesson answered correctly at least once. */
  completed: number;
  total: number;
};

export type LoopBanner = "PARKED" | null;

export type LoopView =
  | {
      type: "QUESTION";
      surface: QuestionSurfaceView;
      progress: ProgressView;
      banner: LoopBanner;
    }
  | {
      type: "EXPLAIN";
      questionId: number;
      explanation: string;
      progress: ProgressView;
    }
  | {
      type: "RETEACH";
      questionId: number;
      progress: ProgressView;
    }
  | {
      type: "COMPLETE";
      pointsEarned: number;
      progress: ProgressView;
      banner: LoopBanner;
    };

/** What the effect list tells the actions layer to do / show. */
export type EffectSummary = {
  persistAttempt: boolean;
  pointsAwarded: number;
  weakConcept: boolean;
  startReteach: boolean;
  serveVariant: boolean;
  parked: boolean;
  completed: boolean;
};

export const summarizeEffects = (effects: LoopEffect[]): EffectSummary => {
  const summary: EffectSummary = {
    persistAttempt: false,
    pointsAwarded: 0,
    weakConcept: false,
    startReteach: false,
    serveVariant: false,
    parked: false,
    completed: false,
  };

  for (const effect of effects) {
    switch (effect.kind) {
      case "PERSIST_ATTEMPT":
        summary.persistAttempt = true;
        break;
      case "AWARD_POINTS":
        summary.pointsAwarded += effect.amount;
        break;
      case "EMIT_WEAK_CONCEPT":
        summary.weakConcept = true;
        break;
      case "START_RETEACH_STREAM":
        summary.startReteach = true;
        break;
      case "SERVE_VARIANT":
        summary.serveVariant = true;
        break;
      case "PARK_CONCEPT":
        summary.parked = true;
        break;
      case "COMPLETE_SESSION":
        summary.completed = true;
        break;
      case "FLAG_MANAGER":
        break;
    }
  }

  return summary;
};

/**
 * The view "shape" implied by a transition — content hydration happens in the
 * actions layer. Returns what the player should show NEXT.
 */
export type NextViewShape =
  | { type: "QUESTION"; surface: "ORIGINAL" | "VARIANT"; banner: LoopBanner }
  | { type: "EXPLAIN" }
  | { type: "RETEACH" }
  | { type: "COMPLETE"; banner: LoopBanner };

export const nextViewShape = (result: TransitionOk): NextViewShape => {
  const summary = summarizeEffects(result.effects);
  const banner: LoopBanner = summary.parked ? "PARKED" : null;

  if (result.session.status === "COMPLETED") {
    return { type: "COMPLETE", banner };
  }

  if (result.session.step === "EXPLAIN") return { type: "EXPLAIN" };
  if (result.session.step === "AI_RETEACH") return { type: "RETEACH" };

  // step === QUESTION: variant surface when one was just served.
  return {
    type: "QUESTION",
    surface: summary.serveVariant ? "VARIANT" : "ORIGINAL",
    banner,
  };
};

/** Deterministic variant pick (stable per cycle so retries re-serve the same one). */
export const pickVariantIndex = (
  variantCount: number,
  questionId: number,
  cycle: number
): number => {
  if (variantCount <= 0) return -1;
  return (questionId * 31 + cycle * 7) % variantCount;
};

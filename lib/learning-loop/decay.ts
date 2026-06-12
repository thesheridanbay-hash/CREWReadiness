/**
 * Memory-loop decay + retraining triggers (P5 — D13). Pure decision logic so
 * the scheduled scan stays testable without a database or AI.
 *
 * The loop is Capture → Distill → Verify → Deploy → Measure → Decay/Correct.
 * This module is the Decay/Correct half: it decides which concepts have
 * decayed (high miss rate once enough crew have attempted them) or gone stale
 * (not refreshed in a long time) and should be flagged to the owner for a
 * refresh — the retraining trigger.
 */

export const DECAY = {
  /** A concept is "decaying" at or above this miss rate… */
  RETRAIN_MISS_RATE: 40,
  /** …but only once this many attempts make the rate meaningful. */
  MIN_ATTEMPTS: 5,
  /** Published content untouched this long is "stale" and worth revisiting. */
  STALE_DAYS: 90,
} as const;

export type ConceptStat = {
  questionId: number;
  attempts: number;
  wrong: number;
};

/** True when a concept's miss rate has decayed past the retrain threshold. */
export const needsRetraining = (stat: ConceptStat): boolean => {
  if (stat.attempts < DECAY.MIN_ATTEMPTS) return false;
  const missRate = (stat.wrong / stat.attempts) * 100;
  return missRate >= DECAY.RETRAIN_MISS_RATE;
};

/** Filter a batch of concept stats down to those needing retraining. */
export const selectDecayedConcepts = (stats: ConceptStat[]): ConceptStat[] =>
  stats.filter(needsRetraining);

/** True when published content hasn't been refreshed within STALE_DAYS. */
export const isStale = (lastPublishedAt: Date | null, now: Date): boolean => {
  if (!lastPublishedAt) return false;
  const ageDays = (now.getTime() - lastPublishedAt.getTime()) / 86_400_000;
  return ageDays >= DECAY.STALE_DAYS;
};

/**
 * Runtime answer-leakage guard for reteach streams (T4 — D19).
 *
 * Reteach content must teach the concept without revealing the correct
 * answer. Before tokens reach the client, the stream passes through this
 * guard: it normalizes text (case, punctuation, whitespace) and holds back a
 * sliding tail window so answers split across chunk boundaries are still
 * caught. On a hit the stream is terminated and the caller falls back to a
 * pre-generated variant (D7).
 */

export const normalize = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/** True when any (meaningful) answer string appears in the text. */
export const containsAnswer = (text: string, answers: string[]): boolean => {
  const haystack = normalize(text);

  return answers.some((answer) => {
    const needle = normalize(answer);
    // Single characters / tiny fragments would false-positive constantly;
    // they can't meaningfully "leak" an answer.
    if (needle.length < 3) return false;
    return haystack.includes(needle);
  });
};

export type LeakGuard = {
  /**
   * Feed a chunk; returns text that is SAFE to emit now (may be empty while
   * the tail window is held back), or null once the guard has tripped.
   */
  push: (chunk: string) => string | null;
  /** End of stream: returns the held-back tail (or null if tripped). */
  flush: () => string | null;
  /** Has the guard detected a leak? */
  readonly tripped: () => boolean;
};

export const createLeakGuard = (correctAnswers: string[]): LeakGuard => {
  // Hold back enough raw characters to cover the longest answer even with
  // punctuation/whitespace inflation between its words.
  const holdback = Math.max(
    16,
    ...correctAnswers.map((answer) => answer.length * 2)
  );

  let pending = "";
  let blocked = false;

  return {
    push: (chunk: string) => {
      if (blocked) return null;

      pending += chunk;

      if (containsAnswer(pending, correctAnswers)) {
        blocked = true;
        return null;
      }

      if (pending.length <= holdback) return "";

      const safe = pending.slice(0, pending.length - holdback);
      pending = pending.slice(pending.length - holdback);
      return safe;
    },
    flush: () => {
      if (blocked) return null;

      if (containsAnswer(pending, correctAnswers)) {
        blocked = true;
        return null;
      }

      const rest = pending;
      pending = "";
      return rest;
    },
    tripped: () => blocked,
  };
};

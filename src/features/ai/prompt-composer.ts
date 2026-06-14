/**
 * Course-builder guidance composer (AI Course Builder).
 *
 * The full-course generator (gateway.generateCourse) is steered by a composed
 * "master prompt" assembled from two TRUSTED, authenticated sources:
 *
 *   - sitePrompt    — platform-owner global baseline (provider_settings,
 *                     `course_builder` row). Applies to every company.
 *   - companyPrompt — the company owner's own guidance (company_settings,
 *                     tenant-scoped). Layered on top of the baseline.
 *
 * Both are set through authed office-role forms, so they are instructions, not
 * data — they go in the prompt's instruction block. The owner's free-text
 * course IDEA is the only untrusted input and is sandwiched separately in the
 * course prompt builders (buildCourseSkeletonPrompt / buildLessonContentPrompt
 * in prompts.ts). This module is pure (no I/O) so the layering rules are
 * unit-testable; the gateway fetches the two parts and passes them here.
 */

export type CourseGuidanceParts = {
  sitePrompt?: string | null;
  companyPrompt?: string | null;
};

/** Trim, drop empties, and bound each part so a runaway prompt can't blow the
 * model's context or our token budget. Generous: guidance is short by design. */
const PART_MAX = 4000;

const clean = (value: string | null | undefined): string =>
  (value ?? "").trim().slice(0, PART_MAX);

/**
 * Compose the trusted guidance block. Returns "" when neither part is set —
 * the generator then falls back to its built-in defaults (the course prompt
 * builders already describe the house style), so an unconfigured platform
 * still produces sensible courses.
 */
export const composeCourseGuidance = (parts: CourseGuidanceParts): string => {
  const site = clean(parts.sitePrompt);
  const company = clean(parts.companyPrompt);

  const blocks: string[] = [];
  if (site) {
    blocks.push(`Platform guidance (applies to all training):\n${site}`);
  }
  if (company) {
    blocks.push(
      `Company-specific guidance (this company's voice and priorities — ` +
        `takes precedence on any conflict):\n${company}`
    );
  }

  return blocks.join("\n\n");
};

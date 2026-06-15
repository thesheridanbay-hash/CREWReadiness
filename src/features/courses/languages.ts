/**
 * Supported content languages (multi-language courses, Phase 1).
 *
 * This list is the ONE extensibility seam: adding a `{ code, label }` entry
 * teaches the whole system a new language. Languages are stored as plain
 * `text` columns (never a pg enum) precisely so a new code needs no DDL — the
 * app validates against this list instead. Codes are BCP-47 primary subtags.
 *
 * `en` is the platform default and the back-compat language: every base
 * content row (lessons/questions/options) is authored in the company's
 * primary language, and translation tables hold the rest, with English as the
 * universal fallback when a translation is missing.
 */
export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English", flag: "🇺🇸" },
  { code: "es", label: "Spanish", flag: "🇪🇸" },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]["code"];

/** Platform default + universal fallback (D-i18n). */
export const DEFAULT_LANGUAGE: LanguageCode = "en";

export const SUPPORTED_LANGUAGE_CODES: readonly string[] =
  SUPPORTED_LANGUAGES.map((l) => l.code);

export const isSupportedLanguage = (code: string): code is LanguageCode =>
  SUPPORTED_LANGUAGE_CODES.includes(code);

/** Human label for a code; falls back to the raw code if unknown. */
export const languageLabel = (code: string): string =>
  SUPPORTED_LANGUAGES.find((l) => l.code === code)?.label ?? code;

/** Flag emoji for a code; a globe for unknown codes. */
export const languageFlag = (code: string): string =>
  SUPPORTED_LANGUAGES.find((l) => l.code === code)?.flag ?? "🌐";

/**
 * Resolve the language a learner should READ in, given their stored
 * preference (nullable = inherit) and the company primary. Always returns a
 * supported code; unknown/blank values collapse to the default. This is the
 * single resolution rule the learner read paths share (PR-C).
 */
export const resolveReadingLanguage = (
  memberPreference: string | null | undefined,
  companyPrimary: string | null | undefined
): LanguageCode => {
  for (const candidate of [memberPreference, companyPrimary]) {
    if (candidate && isSupportedLanguage(candidate)) return candidate;
  }
  return DEFAULT_LANGUAGE;
};

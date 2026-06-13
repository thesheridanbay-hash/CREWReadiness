import { describe, expect, it } from "vitest";

import {
  DEFAULT_LANGUAGE,
  isSupportedLanguage,
  languageLabel,
  resolveReadingLanguage,
} from "@/lib/content/languages";

/**
 * languages.ts is the single extensibility seam for multi-language courses;
 * resolveReadingLanguage is the fallback chain every learner read shares.
 */

describe("isSupportedLanguage", () => {
  it("accepts configured codes and rejects others", () => {
    expect(isSupportedLanguage("en")).toBe(true);
    expect(isSupportedLanguage("es")).toBe(true);
    expect(isSupportedLanguage("fr")).toBe(false);
    expect(isSupportedLanguage("")).toBe(false);
  });
});

describe("languageLabel", () => {
  it("maps a code to its label, falling back to the raw code", () => {
    expect(languageLabel("en")).toBe("English");
    expect(languageLabel("es")).toBe("Spanish");
    expect(languageLabel("fr")).toBe("fr");
  });
});

describe("resolveReadingLanguage", () => {
  it("prefers a valid member preference", () => {
    expect(resolveReadingLanguage("es", "en")).toBe("es");
  });

  it("falls back to the company primary when there is no preference", () => {
    expect(resolveReadingLanguage(null, "es")).toBe("es");
    expect(resolveReadingLanguage(undefined, "es")).toBe("es");
  });

  it("ignores an unsupported preference and uses the primary", () => {
    expect(resolveReadingLanguage("fr", "es")).toBe("es");
  });

  it("collapses to the default when nothing is valid", () => {
    expect(resolveReadingLanguage(null, "fr")).toBe(DEFAULT_LANGUAGE);
    expect(resolveReadingLanguage("zz", null)).toBe(DEFAULT_LANGUAGE);
  });
});

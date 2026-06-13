import { describe, expect, it } from "vitest";

import { composeCourseGuidance } from "@/features/ai/prompt-composer";

/**
 * Course-builder guidance composition (pure). The layering rules decide what
 * steers full-course generation, so they're worth pinning down directly.
 */

describe("composeCourseGuidance", () => {
  it("returns empty when neither part is set", () => {
    expect(composeCourseGuidance({})).toBe("");
    expect(composeCourseGuidance({ sitePrompt: "  ", companyPrompt: null })).toBe(
      ""
    );
  });

  it("includes only the site prompt when company is absent", () => {
    const out = composeCourseGuidance({ sitePrompt: "Be concrete." });
    expect(out).toContain("Platform guidance");
    expect(out).toContain("Be concrete.");
    expect(out).not.toContain("Company-specific");
  });

  it("includes only the company prompt when site is absent", () => {
    const out = composeCourseGuidance({ companyPrompt: "We mow in Texas heat." });
    expect(out).toContain("Company-specific guidance");
    expect(out).toContain("We mow in Texas heat.");
    expect(out).not.toContain("Platform guidance");
  });

  it("orders site first, then company (company takes precedence on conflict)", () => {
    const out = composeCourseGuidance({
      sitePrompt: "SITE_RULES",
      companyPrompt: "COMPANY_RULES",
    });
    expect(out.indexOf("SITE_RULES")).toBeLessThan(out.indexOf("COMPANY_RULES"));
    expect(out).toMatch(/takes precedence/i);
  });

  it("trims and bounds each part to keep the prompt sane", () => {
    const huge = "x".repeat(9000);
    const out = composeCourseGuidance({ sitePrompt: `  ${huge}  ` });
    // 4000-char cap per part; not the full 9000.
    expect(out).toContain("x".repeat(4000));
    expect(out).not.toContain("x".repeat(4001));
  });
});

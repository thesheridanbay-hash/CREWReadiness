import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";
import importPlugin from "eslint-plugin-import";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  prettier,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
  // ── Architecture guard (repo reshape) ───────────────────────────────────────
  // No import cycles, anywhere. Zero today; this keeps it that way (CI-blocking).
  {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: { import: importPlugin },
    settings: {
      "import/resolver": { typescript: { project: "./tsconfig.json" } },
    },
    rules: {
      "import/no-cycle": ["error", { maxDepth: 6 }],
    },
  },
  // ── Feature-boundary guard: shared/ must stay a leaf ────────────────────────
  // src/shared/** may not make VALUE imports up into features/app/app-shell.
  // Type-only imports ARE allowed (e.g. shared/db/scoped.ts importing the auth
  // Session type for signatures). Cross-feature value imports between features
  // are permitted and kept safe from cycles by import/no-cycle above.
  // (eslint-plugin-boundaries is installed if per-feature surface rules are
  // wanted later; this lighter rule enforces the load-bearing invariant.)
  {
    files: ["src/shared/**/*.ts", "src/shared/**/*.tsx"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/features/*", "@/app/*", "@/app-shell/*"],
              allowTypeImports: true,
              message:
                "shared/ is a leaf: no value imports from features/app/app-shell (type-only is allowed).",
            },
          ],
        },
      ],
    },
  },
  // ── Brand-color token guard (cross-brand re-skin) ───────────────────────────
  // No raw Tailwind palette colors in app code — use the semantic brand tokens
  // (brand/gold/success/danger/info + canvas/surface/ink/line) so a future
  // re-skin stays a one-place token edit instead of a 49-file sweep. See
  // DESIGN.md. The tokens (brand-/gold-/success-/etc.) don't match the pattern.
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "Literal[value=/(?:bg|text|border|ring|fill|stroke|from|via|to|divide|outline|decoration|placeholder|caret|shadow)-(?:green|sky|teal|indigo|rose|amber|emerald|lime|cyan|blue|violet|purple|fuchsia|pink|orange|yellow)-[0-9]/]",
          message:
            "Use semantic brand tokens (brand/gold/success/danger/info/canvas/surface/ink/line) instead of raw Tailwind palette colors. See DESIGN.md.",
        },
        {
          selector:
            "TemplateElement[value.raw=/(?:bg|text|border|ring|fill|stroke|from|via|to|divide|outline|decoration|placeholder|caret|shadow)-(?:green|sky|teal|indigo|rose|amber|emerald|lime|cyan|blue|violet|purple|fuchsia|pink|orange|yellow)-[0-9]/]",
          message:
            "Use semantic brand tokens instead of raw Tailwind palette colors. See DESIGN.md.",
        },
      ],
    },
  },
];

export default eslintConfig;

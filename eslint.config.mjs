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
];

export default eslintConfig;

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
  // ── Architecture guard (added Phase 0 of the repo reshape) ──────────────────
  // import/no-cycle is LIVE in WARN so the baseline stays green. Flip to "error"
  // in Phase F once the feature layout lands and cycles are triaged to zero.
  {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: { import: importPlugin },
    settings: {
      "import/resolver": { typescript: { project: "./tsconfig.json" } },
    },
    rules: {
      "import/no-cycle": ["warn", { maxDepth: 6 }],
    },
  },
  // ── Feature-boundary guard — STAGED for Phase F ─────────────────────────────
  // eslint-plugin-boundaries is installed. It cannot enforce until src/features/*
  // exists, so it is intentionally NOT wired yet. In Phase F, add this block and
  // flip it to "error":
  //   settings: { "boundaries/elements": [
  //     { type: "app",       pattern: "src/app/**" },
  //     { type: "app-shell", pattern: "src/app-shell/**" },
  //     { type: "feature",   pattern: "src/features/*/**", capture: ["name"] },
  //     { type: "shared",    pattern: "src/shared/**" },
  //   ] },
  //   rules: { "boundaries/element-types": ["error", { default: "disallow", rules: [
  //     { from: "shared",             disallow: ["feature", "app", "app-shell"] },
  //     { from: "feature",            allow: ["shared"] },        // + type-only cross-feature
  //     { from: ["app", "app-shell"], allow: ["feature", "shared"] },
  //   ] }] }
  //   // root proxy.ts is exempt (infra that imports a feature policy).
];

export default eslintConfig;

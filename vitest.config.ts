import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    /**
     * Integration suites (RLS isolation, action matrices) self-skip when
     * DATABASE_URL_TEST is absent — see tests/integration/. Unit suites run
     * everywhere.
     */
  },
});

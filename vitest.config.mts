import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit + component tests. The live-fire QA suites under scripts/tests are NOT
// vitest: they hit real backends and are opt-in via `npm run test:live:*`.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // The interaction audit is Playwright, driving a real browser against a
    // real build. It lives under tests/ for discoverability but must never be
    // collected here: vitest would import a spec that expects a browser.
    exclude: ["tests/interaction/**", "node_modules/**"],
    setupFiles: ["tests/setup.ts"],
    // Component tests opt into jsdom per file with
    // `// @vitest-environment jsdom`.
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      include: ["lib/**/*.ts", "app/api/**/*.ts", "proxy.ts", "components/**/*.tsx", "components/**/*.ts"],
      exclude: ["lib/questions.si.ts", "lib/questions.i18n.ts", "lib/templates/signature.ts"],
      thresholds: {
        // A RATCHET, not an aspiration. These sit just below the measured
        // numbers, so the gate fails the moment coverage drops and passes while
        // it holds or climbs. Raise them as coverage grows, never the reverse.
        //
        // components/** is now in `include` (AUDIT.md OPS-06) so UI regressions
        // are measured rather than invisible; that pulled the aggregate down
        // from the ~47 lib+api-only figure to ~44-45 because most components
        // have no unit test yet. The floor moved with it. The GitHub
        // integration this most needs to protect is far above the aggregate:
        // actions 100, handlers 100, api 98.9, processor 99, projection 99,
        // client 98. See docs/TESTING.md. Raising toward the mandate's
        // 80/95 targets is test-writing work tracked in AUDIT.md.
        lines: 45,
        functions: 45,
        branches: 37,
        statements: 44,
      },
    },
  },
});

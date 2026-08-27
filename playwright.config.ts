// Playwright for the interaction and responsiveness audit.
//
// Separate from Vitest on purpose. Vitest is the unit and component suite and
// must never touch the network; this harness drives a REAL browser against a
// REAL production build, because the things it measures (layout, overflow,
// focus rings, tap targets, INP) do not exist in jsdom.
//
// It runs against a local `next start`, never against production, so an audit
// pass cannot mutate the live store. The one credential it needs is a session
// cookie, minted locally by the global setup.
import { defineConfig, devices } from "@playwright/test";

/** The audit's own port, so it cannot collide with a dev server left running. */
export const PORT = 3199;
/** TLS terminator in front of PORT. See tests/interaction/tls-proxy.mjs. */
export const TLS_PORT = 3200;
// HTTPS, not http, and the reason matters. The session cookie is `Secure`,
// correctly. Chromium sends Secure cookies over http://localhost anyway;
// WebKit does not. Run over http and the entire touch project redirects to
// /login and measures the sign-in page while reporting success. Terminating
// TLS locally keeps the production cookie flags honest and keeps Safari in
// the matrix.
export const BASE_URL = `https://localhost:${TLS_PORT}`;

export default defineConfig({
  testDir: "./tests/interaction",
  // Audit reports are written by the tests themselves; ordering matters for
  // the report files, and a browser measurement under CPU contention is a
  // measurement of the contention.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: "docs/audit/interaction/playwright-report", open: "never" }],
  ],
  outputDir: "docs/audit/interaction/test-results",

  use: {
    baseURL: BASE_URL,
    // The loopback certificate is self-signed and regenerated on demand.
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Deterministic rendering: animations settle, so a screenshot is of the
    // resting state rather than whatever frame the timer landed on.
    launchOptions: { args: ["--font-render-hinting=none"] },
  },

  projects: [
    { name: "setup", testMatch: /global\.setup\.ts/ },

    // Pure filesystem check, no browser and no session needed. First, because
    // an inventory that has drifted invalidates everything after it.
    { name: "inventory", testMatch: /enumerated-routes\.spec\.ts/ },

    // The viewport matrix from section 5.1. Widths are the audit's subject,
    // so they are declared here rather than hidden inside a test.
    ...(
      [
        ["320", 320, 640],
        ["360", 360, 800],
        ["390", 390, 844],
        ["430", 430, 932],
        ["768", 768, 1024],
        ["834", 834, 1112],
        ["1024", 1024, 768],
        ["1280", 1280, 800],
        ["1440", 1440, 900],
        ["1920", 1920, 1080],
        ["2560", 2560, 1440],
        ["3440", 3440, 1440],
      ] as const
    ).map(([name, width, height]) => ({
      name: `w${name}`,
      dependencies: ["setup"],
      testMatch: /viewport\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width, height },
        storageState: "docs/audit/interaction/.auth/state.json",
      },
    })),

    // Landscape phone: the height-constrained case where sticky headers and
    // footers can leave almost no content area.
    {
      name: "landscape-640x360",
      dependencies: ["setup"],
      testMatch: /viewport\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 640, height: 360 },
        storageState: "docs/audit/interaction/.auth/state.json",
      },
    },

    {
      name: "touch",
      dependencies: ["setup"],
      testMatch: /(modality|overlay)\.spec\.ts/,
      use: {
        ...devices["iPhone 15"],
        storageState: "docs/audit/interaction/.auth/state.json",
      },
    },
    {
      name: "keyboard",
      dependencies: ["setup"],
      testMatch: /(keyboard|overlay)\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        storageState: "docs/audit/interaction/.auth/state.json",
      },
    },
    {
      name: "axe",
      dependencies: ["setup"],
      testMatch: /a11y\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        storageState: "docs/audit/interaction/.auth/state.json",
      },
    },
    {
      name: "perf",
      dependencies: ["setup"],
      testMatch: /perf\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        storageState: "docs/audit/interaction/.auth/state.json",
      },
    },
  ],

  webServer: [
    {
      // A production build, not `next dev`: dev ships an HMR runtime,
      // unminified React and different timing, so measuring it would measure
      // the wrong app.
      command: `npx next start --port ${PORT}`,
      url: `http://127.0.0.1:${PORT}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `node tests/interaction/tls-proxy.mjs`,
      url: `${BASE_URL}/login`,
      ignoreHTTPSErrors: true,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
      env: { IX_UPSTREAM_PORT: String(PORT), IX_TLS_PORT: String(TLS_PORT) },
    },
  ],
});

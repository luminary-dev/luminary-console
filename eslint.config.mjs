// Flat config. The security-shaped rules (no-unsanitized, no-eval, the
// restricted-syntax bans below) are merge gates, not style preferences: this
// app renders client-supplied text and, since the GitHub work, third-party
// payloads.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import nounsanitized from "eslint-plugin-no-unsanitized";

// Shared no-restricted-syntax bans. Kept in a const because flat config
// replaces a rule's options rather than merging them: the app/components
// block below re-declares the rule to add the em-dash ban, and would
// otherwise silently drop these two.
const RESTRICTED_SYNTAX = [
  {
    // House rule: no browser dialogs. The console uses ConfirmDialog.
    selector:
      "CallExpression[callee.object.name='window'][callee.property.name=/^(alert|confirm|prompt)$/]",
    message: "Use the themed ConfirmDialog (components/ConfirmDialog.tsx), not a browser dialog.",
  },
  {
    // Timing-unsafe comparison of a secret is how webhook/cron auth gets
    // broken; both call sites must use timingSafeEqual.
    selector:
      "BinaryExpression[operator=/^(===|!==|==|!=)$/][left.name=/[Ss]ecret$|[Ss]ignature$|[Tt]oken$/]",
    message:
      "Compare secrets/signatures with crypto.timingSafeEqual, never with ===.",
  },
];

// LC-051: em dashes are banned in user-facing copy. One exemption, matched by
// the :not() clauses: a literal whose whole trimmed value is a single em dash
// is the table placeholder for "no value", not prose.
const NO_EM_DASH_MESSAGE =
  "No em dashes (—) in user-facing copy. Use a comma, a colon or a full stop instead. (A standalone \"—\" used as an empty-value placeholder is allowed.)";
const NO_EM_DASH = [
  {
    selector: "Literal[value=/—/]:not(Literal[value=/^\\s*—\\s*$/])",
    message: NO_EM_DASH_MESSAGE,
  },
  {
    selector: "TemplateElement[value.raw=/—/]:not(TemplateElement[value.raw=/^\\s*—\\s*$/])",
    message: NO_EM_DASH_MESSAGE,
  },
  {
    selector: "JSXText[value=/—/]:not(JSXText[value=/^\\s*—\\s*$/])",
    message: NO_EM_DASH_MESSAGE,
  },
];

export default tseslint.config(
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      ".agents/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mjs}"],
    plugins: {
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y,
      "no-unsanitized": nounsanitized,
    },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        console: "readonly",
        process: "readonly",
        fetch: "readonly",
        Response: "readonly",
        Request: "readonly",
        Headers: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        crypto: "readonly",
        Buffer: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        btoa: "readonly",
        atob: "readonly",
        ReadableStream: "readonly",
        AbortController: "readonly",
        __dirname: "readonly",
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        localStorage: "readonly",
        location: "readonly",
        HTMLElement: "readonly",
        HTMLInputElement: "readonly",
        HTMLTextAreaElement: "readonly",
        HTMLButtonElement: "readonly",
        KeyboardEvent: "readonly",
        MediaQueryListEvent: "readonly",
        FileList: "readonly",
        RequestInit: "readonly",
        RequestInfo: "readonly",
        BodyInit: "readonly",
        FontFaceSet: "readonly",
        Element: "readonly",
        Document: "readonly",
        Notification: "readonly",
        React: "readonly",
        requestAnimationFrame: "readonly",
      },
    },
    rules: {
      // --- security gates ---
      "no-unsanitized/method": "error",
      "no-unsanitized/property": "error",
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-restricted-syntax": ["error", ...RESTRICTED_SYNTAX],

      // --- correctness ---
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-floating-promises": "off", // needs type-aware linting; enabled in the typecheck pass
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-console": ["warn", { allow: ["warn", "error"] }],

      // --- accessibility (WCAG 2.2 AA is the floor) ---
      ...jsxA11y.flatConfigs.recommended.rules,
      "jsx-a11y/no-autofocus": "off", // deliberate on dialog/first-field focus
    },
  },
  {
    // Copy gate. Everything a client or the operator reads is rendered from
    // app/** and components/**, so the em-dash ban is scoped to those trees
    // (lib/templates and lib/publish are covered by review, not by lint).
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": ["error", ...RESTRICTED_SYNTAX, ...NO_EM_DASH],
    },
  },
  {
    // The service worker runs in a worker global scope, not a window.
    files: ["public/sw.js"],
    languageOptions: {
      globals: { self: "readonly", clients: "readonly", registration: "readonly" },
    },
  },
  {
    // Scripts and tests are allowed to log and to reach for `any` at the
    // edges of third-party payloads.
    files: ["scripts/**/*.ts", "tests/**/*.ts", "tests/**/*.tsx", "*.config.ts", "*.config.mjs"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);

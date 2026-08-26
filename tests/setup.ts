// Global test setup. The single most important job here is making it
// impossible for a unit test to reach the real Cloudflare R2 bucket, the real
// Anthropic account, or the real mail/notification channels: this repo runs
// against a live store with a real client on it.
import { beforeEach, vi } from "vitest";

// Point every credential at an obviously-fake value. lib/r2.ts reads these at
// call time, so any accidental real client construction targets nothing.
process.env.R2_ACCOUNT_ID = "test-account";
process.env.R2_ACCESS_KEY_ID = "test-key";
process.env.R2_SECRET_ACCESS_KEY = "test-secret";
process.env.R2_BUCKET = "test-bucket";
process.env.R2_ENDPOINT = "http://127.0.0.1:1/blocked";
process.env.SESSION_SECRET = "test-session-secret-not-a-real-one";
process.env.ROOT_DOMAIN = "example.test";
process.env.CONSOLE_HOST = "console.example.test";

// Anything that would spend money or notify a human is unset, so the guarded
// no-op path in each module is what runs.
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.RESEND_API_KEY;
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.TELEGRAM_CHAT_ID;
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;
delete process.env.CLOUDFLARE_API_TOKEN;
delete process.env.VERCEL_TOKEN;
delete process.env.GH_TOKEN;
delete process.env.GITHUB_APP_ID;
delete process.env.GITHUB_APP_PRIVATE_KEY;
delete process.env.GITHUB_WEBHOOK_SECRET;

// Fail loudly if a test tries to reach the network. Individual tests that
// exercise a fetch boundary stub globalThis.fetch themselves.
const blockedFetch = vi.fn(async (input: RequestInfo | URL) => {
  throw new Error(
    `Network access is blocked in unit tests (attempted: ${String(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    )}). Stub globalThis.fetch in the test if this boundary is under test.`,
  );
});

beforeEach(() => {
  globalThis.fetch = blockedFetch as unknown as typeof fetch;
});

// Mints an operator session for the audit and saves it as Playwright storage
// state, so every project starts signed in.
//
// The token is generated locally from SESSION_SECRET against a session id that
// is already in the registry, which is the same thing the login flow produces.
// It is written under docs/audit/interaction/.auth/, which is gitignored: a
// session token is a credential even when it is our own.
import { test as setup, expect } from "@playwright/test";
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { BASE_URL } from "../../playwright.config";

const STATE = "docs/audit/interaction/.auth/state.json";

setup("mint an operator session", async ({ page, context }) => {
  const secret = process.env.SESSION_SECRET;
  expect(
    secret,
    "SESSION_SECRET must be set. Run the harness with: npx dotenv -e .env.local -- npx playwright test, " +
      "or export it first. The audit signs in as a real operator because most of the console is behind the gate.",
  ).toBeTruthy();

  const { liveSids } = await import("../../lib/sessions");
  const { makeSessionToken } = await import("../../lib/auth");

  const sids = await liveSids();
  expect(
    sids.length,
    "No live session ids in the registry. Sign in to the console once, then re-run: the audit " +
      "reuses an existing session rather than creating one, so it cannot pollute the session list.",
  ).toBeGreaterThan(0);

  const token = await makeSessionToken(secret as string, sids[0] as string);

  await context.addCookies([
    {
      name: "lum_session",
      value: token,
      url: BASE_URL,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

  // Prove the cookie actually authenticates before saving it. A silently
  // invalid session would turn every later assertion into an assertion about
  // the login page.
  const res = await page.goto(`${BASE_URL}/`);
  expect(res?.status(), "the dashboard should answer 200 for a signed-in operator").toBe(200);
  await expect(page).toHaveURL(/\/$/);

  if (!existsSync(dirname(STATE))) mkdirSync(dirname(STATE), { recursive: true });
  await context.storageState({ path: STATE });
});

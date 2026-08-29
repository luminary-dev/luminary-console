// The session gate, checked from outside it.
//
// Every other project in this harness signs in first, which means none of them
// can see the difference between an asset that is protected and one that is
// simply present. This spec is the only one that carries no session: it asks
// for things as a stranger would and asserts what comes back.
//
// It exists because the comic was deliberately moved behind the gate, and a
// "private" asset that quietly becomes public again is the kind of regression
// nothing else here would notice: signed-in, the page looks identical either
// way. Adding /comic/ to the exemption list in proxy.ts would turn every panel
// public, and this is what fails when someone does.
import { test, expect, request } from "@playwright/test";
import { BASE_URL } from "../../playwright.config";
import { PANELS, variantsFor } from "../../lib/comic";

/** A request context with no storage state at all: no cookies, no session.
 *  storageState is omitted rather than set to undefined, which is what a
 *  fresh context defaults to and what exactOptionalPropertyTypes requires. */
async function stranger() {
  return request.newContext({ baseURL: BASE_URL, ignoreHTTPSErrors: true });
}

test.use({ storageState: { cookies: [], origins: [] } });

test("a signed-out visitor cannot read the comic", async () => {
  const api = await stranger();
  try {
    // Both the masters and the variants: the masters are still in public/ so
    // the artwork can be re-encoded without paying to redraw it, which means
    // they are just as reachable and need the same gate.
    const paths = PANELS.flatMap((p) => [`/comic/${p.file}`, ...variantsFor(p).map((v) => v.url)]);
    expect(paths.length).toBe(27); // 9 masters + 18 variants; fails loudly if a panel is added without one

    for (const path of paths) {
      const res = await api.get(path, { maxRedirects: 0 });
      expect(
        res.status(),
        `${path} answered ${res.status()} to a request with no session. The comic is meant ` +
          `to be private: check that proxy.ts has not had /comic/ added back to its list of ` +
          `public assets.`,
      ).toBe(307);
      expect(res.headers()["location"] ?? "").toContain("/login");
    }
  } finally {
    await api.dispose();
  }
});

test("the genuinely public assets are still public", async () => {
  const api = await stranger();
  try {
    // The other half of the assertion. Without it, a change that gated
    // everything would pass the test above while breaking the installed PWA,
    // whose service worker and manifest are fetched signed-out by design.
    for (const path of ["/manifest.webmanifest", "/icon.svg", "/sw.js"]) {
      const res = await api.get(path, { maxRedirects: 0 });
      expect(res.status(), `${path} should stay reachable without a session`).toBe(200);
    }
  } finally {
    await api.dispose();
  }
});

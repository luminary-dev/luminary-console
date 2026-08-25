// HTML → PDF via headless Chromium (@sparticuz/chromium on Vercel, system
// Chrome locally). Same proven setup as the questionnaire app.
//
// Two modes:
//  - default (documents): A4 print pages, print stylesheet.
//  - laptop (design previews): render at a desktop viewport and emit ONE page
//    sized to the full scroll height, using the *screen* stylesheet — so the
//    PDF looks like the site does on a laptop, top to bottom, not a narrow A4
//    reflow that triggers mobile breakpoints. Before capturing it "hydrates"
//    the page: scrolls the whole document to fire lazy-loading and scroll-
//    reveal animations, forces still-hidden reveal elements visible, eager-
//    loads images, and waits (bounded) for fonts + images — otherwise the
//    snapshot shows placeholder images and missing (opacity:0) text.
//
// The hydrate steps are best-effort: on constrained serverless Chromium a
// single step failing must NOT abort the whole render, or a client can't get
// their preview at all. We degrade to whatever loaded rather than throwing.
//
// Chromium is launched at most once per serverless invocation, not once per
// document (LC-032): see the browser lifecycle section below.
import type { Browser } from "puppeteer-core";

/** Laptop viewport width the design is laid out at before capture. */
const LAPTOP_WIDTH = 1280;

/** PDF page dimensions are limited to ~200in (14400px) per the spec; keep a
 *  margin under it so a very long page still produces a valid single-page PDF
 *  instead of failing outright. */
const MAX_PAGE_PX = 14000;

/** Longest any render waits on web fonts before giving up and printing with
 *  whatever is loaded. Both modes use it: an unbounded `fonts.ready` held the
 *  A4 path until the 120s protocol timeout when a font fetch hung. */
const FONT_WAIT_MS = 20_000;

/** How long a warm browser may sit unused before it is closed. Long enough to
 *  span the gaps inside one pipeline run (draft, render, save, next document),
 *  short enough that an instance the platform is about to freeze is not
 *  holding a Chromium it will never use again. */
const IDLE_SHUTDOWN_MS = 30_000;

export type RenderPdfOptions = {
  /** Capture the page at laptop width as a single full-height page (see above). */
  laptop?: boolean;
};

/** One document in a batch render. */
export type RenderPdfItem = { html: string; opts?: RenderPdfOptions };

/* eslint-disable @typescript-eslint/no-explicit-any */
// Best-effort: run a hydrate step, swallow (and note) any failure.
async function step(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.warn(`[pdf] hydrate step "${label}" skipped:`, (e as Error)?.message ?? e);
  }
}

async function hydrateForCapture(page: any): Promise<void> {
  // Neutralise animations/transitions and force common scroll-reveal patterns
  // visible, so nothing is captured mid-animation or left hidden.
  await step("reveal-css", () =>
    page.addStyleTag({
      content: `*,*::before,*::after{
          animation:none!important;transition:none!important;
          animation-delay:0s!important;transition-delay:0s!important;
          scroll-behavior:auto!important;}
        [data-aos],.aos-init,.aos-animate,.wow,.reveal,.fade-in,.fade-up,
        [data-animate],[data-scroll],.animate,.animated,.is-inview,.gsap-reveal{
          opacity:1!important;transform:none!important;visibility:visible!important;
          filter:none!important;clip-path:none!important;}`,
    }),
  );

  // Walk the page top-to-bottom to fire lazy-load / on-scroll behaviour.
  await step("scroll", () =>
    page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        let last = -1;
        const step = 500;
        const started = Date.now();
        const timer = setInterval(() => {
          window.scrollBy(0, step);
          const h = document.body.scrollHeight;
          // Stop at the bottom, if we stop moving, or after a hard time cap.
          if (
            window.scrollY + window.innerHeight >= h ||
            window.scrollY === last ||
            Date.now() - started > 15_000
          ) {
            clearInterval(timer);
            window.scrollTo(0, 0);
            resolve();
          }
          last = window.scrollY;
        }, 50);
      });
    }),
  );

  // Eager-load images (incl. data-src/data-srcset lazy patterns) and wait —
  // bounded — for them to settle so none render as a placeholder.
  await step("images", () =>
    page.evaluate(async () => {
      const imgs = Array.from(document.images) as HTMLImageElement[];
      for (const img of imgs) {
        img.loading = "eager";
        const ds = img.getAttribute("data-src");
        if (ds && !img.currentSrc) img.src = ds;
        const dss = img.getAttribute("data-srcset");
        if (dss && !img.srcset) img.srcset = dss;
      }
      const pending = imgs
        .filter((i) => !i.complete)
        .map((i) => new Promise<void>((r) => {
          i.addEventListener("load", () => r(), { once: true });
          i.addEventListener("error", () => r(), { once: true });
        }));
      // Never block longer than 20s on stragglers.
      await Promise.race([
        Promise.all(pending),
        new Promise<void>((r) => setTimeout(r, 20_000)),
      ]);
    }),
  );

  // Wait (generously) for web fonts to actually load. This matters a lot on
  // serverless: Google Fonts arrive well after the load event, and if we
  // measure the page height before they apply, the fallback-font layout is
  // taller — the real fonts then reflow the content shorter, leaving a big
  // empty tail below the footer on a page whose height is already locked.
  await step("fonts", () =>
    page.evaluate(
      (ms: number) =>
        Promise.race([
          (document as Document & { fonts: FontFaceSet }).fonts.ready,
          new Promise((r) => setTimeout(r, ms)),
        ]),
      FONT_WAIT_MS,
    ),
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ——— browser lifecycle (LC-032) ———
//
// One Chromium is kept at module scope and reused by every render this
// instance performs, instead of a launch and a close per document. On
// serverless that cold start is seconds, and stage 2 alone renders three
// documents.
//
// Two things make reuse safe rather than a source of half-dead handles:
//
//  1. A serverless function is frozen and thawed. The Chromium child process
//     can be reaped while we are frozen, or its websocket torn down, leaving a
//     handle that looks fine and throws on first use. So a warm browser is
//     checked (`connected`) before it is handed out, and any render that fails
//     against a handle that turns out to be dead drops it and retries once on
//     a freshly launched one. A leaked process is bounded by the idle timer
//     below and by the sandbox dying with us.
//  2. Nothing keeps the event loop alive on our account: the idle timer is
//     unref'd, so being frozen mid-countdown costs nothing.

let warmBrowser: Browser | null = null;
/** In-flight launch, so two concurrent renders cannot start two Chromiums. */
let launching: Promise<Browser> | null = null;
/** Renders currently holding the warm browser. */
let inFlight = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

async function launchBrowser(): Promise<Browser> {
  const puppeteer = await import("puppeteer-core");
  if (process.env.VERCEL) {
    const chromium = (await import("@sparticuz/chromium")).default;
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
      protocolTimeout: 120_000,
    });
  }
  return puppeteer.launch({
    executablePath:
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
    protocolTimeout: 120_000,
  });
}

/** `connected` can itself throw on a torn-down handle, and "I could not tell"
 *  has to mean "not usable" here. */
function isAlive(browser: Browser): boolean {
  try {
    return browser.connected;
  } catch {
    return false;
  }
}

/** Errors that mean the browser, not the page, is gone. Puppeteer surfaces
 *  these as plain messages, so matching on them is the available signal. */
const DEAD_BROWSER =
  /target closed|session closed|connection closed|browser (?:has )?(?:been )?(?:disconnected|closed)|protocol error|websocket|socket hang up|browser process|not connected/i;

function looksDead(e: unknown): boolean {
  return DEAD_BROWSER.test(e instanceof Error ? e.message : String(e));
}

async function closeQuietly(browser: Browser): Promise<void> {
  try {
    await browser.close();
  } catch {
    // Closing a browser that is already gone is the normal case here.
  }
}

async function dropWarmBrowser(): Promise<void> {
  const browser = warmBrowser;
  warmBrowser = null;
  if (browser) await closeQuietly(browser);
}

function scheduleIdleShutdown(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (inFlight > 0) return;
    void dropWarmBrowser();
  }, IDLE_SHUTDOWN_MS);
  // setTimeout is typed as the DOM's number here; on Node the handle has
  // unref, and holding an invocation open purely to close a browser later is
  // exactly what we do not want.
  (idleTimer as unknown as { unref?: () => void }).unref?.();
}

async function acquireBrowser(fresh: boolean): Promise<Browser> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (fresh || (warmBrowser && !isAlive(warmBrowser))) await dropWarmBrowser();
  if (warmBrowser) {
    inFlight++;
    return warmBrowser;
  }
  if (!launching) {
    launching = launchBrowser().finally(() => {
      launching = null;
    });
  }
  const browser = await launching;
  warmBrowser = browser;
  inFlight++;
  return browser;
}

async function releaseBrowser(browser: Browser, discard: boolean): Promise<void> {
  inFlight = Math.max(0, inFlight - 1);
  if (!discard) {
    if (inFlight === 0) scheduleIdleShutdown();
    return;
  }
  // Only a browser that is actually dead is discarded, so tearing it out from
  // under a concurrent render takes nothing from it that still worked: that
  // render is failing against the same corpse and will retry on the new one.
  if (warmBrowser === browser) await dropWarmBrowser();
  else await closeQuietly(browser);
}

/** Run `fn` against a browser, recovering once from a handle that died while
 *  the instance was frozen. */
async function withBrowser<T>(fn: (browser: Browser) => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const browser = await acquireBrowser(attempt > 0);
    let discard = false;
    try {
      return await fn(browser);
    } catch (e) {
      lastError = e;
      discard = !isAlive(browser) || looksDead(e);
      // A render that failed on its own merits (bad HTML, a page timeout) is
      // the caller's error and must surface unchanged; only a dead browser
      // earns the retry, and only one.
      if (!(discard && attempt === 0)) throw e;
      console.warn("[pdf] browser handle was dead, relaunching once.");
    } finally {
      await releaseBrowser(browser, discard);
    }
  }
  throw lastError;
}

/** Close the warm browser now. Nothing in the request path needs this, the
 *  idle timer covers that; it exists for scripts and tests that must not leave
 *  a Chromium behind. */
export async function shutdownPdfBrowser(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  await dropWarmBrowser();
}

// ——— rendering ———

async function renderOnPage(
  browser: Browser,
  html: string,
  opts: RenderPdfOptions,
): Promise<Buffer> {
  const page = await browser.newPage();
  try {
    if (opts.laptop) {
      // deviceScaleFactor 1: a tall page at 2x can exhaust serverless memory
      // and crash Chromium; PDF text stays vector either way.
      await page.setViewport({ width: LAPTOP_WIDTH, height: 800, deviceScaleFactor: 1 });
      // Render what the client sees on screen, not any @media print rules.
      await page.emulateMediaType("screen");
      // "load" (not networkidle0) — networkidle never settles on pages that
      // poll/animate and then times out; hydrate waits for images itself.
      await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
      await hydrateForCapture(page);

      // One page as tall as the whole (now hydrated) document — but end at the
      // footer's bottom when there is one, so trailing empty space below it
      // (extra body height, off-screen decorations) doesn't pad the page.
      const height = await page.evaluate(async () => {
        // Belt-and-suspenders: ensure fonts are applied and the layout has
        // fully reflowed BEFORE measuring, so the height matches what page.pdf
        // will actually paint (otherwise a late font reflow leaves an empty
        // tail). Two rAFs guarantee a post-reflow frame.
        try {
          await Promise.race([
            (document as Document & { fonts: FontFaceSet }).fonts.ready,
            new Promise((r) => setTimeout(r, 20_000)),
          ]);
        } catch {
          /* ignore — measure whatever we have */
        }
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));

        const docBottom = Math.max(
          document.documentElement.scrollHeight,
          document.body?.scrollHeight ?? 0,
        );
        const footer = document.querySelector(
          'footer, [role="contentinfo"], .footer, #footer, .site-footer',
        );
        if (footer) {
          const b = footer.getBoundingClientRect().bottom + window.scrollY;
          // Only trim (never extend past the real document), and ignore a
          // footer that sits suspiciously near the very top.
          if (b > 200 && b < docBottom) return Math.ceil(b);
        }
        return Math.ceil(docBottom);
      });
      const pageH = Math.min(Math.max(height, 200), MAX_PAGE_PX);
      // Resolve viewport units against the laptop width. page.pdf() otherwise
      // resolves `vw` against a default ~794px print width, which makes the
      // design's clamp(min, Xvw, max) section spacing collapse to its min and
      // packs the content far shorter than the laptop view — leaving a big
      // empty tail on a page whose height we sized to the (correct) screen
      // layout. Declaring an @page box at LAPTOP_WIDTH and printing with
      // preferCSSPageSize makes vw resolve against 1280px, so the printed
      // layout matches the screen exactly and the content fills the page.
      await page.addStyleTag({ content: `@page{size:${LAPTOP_WIDTH}px ${pageH}px;margin:0}` });
      const pdf = await page.pdf({
        preferCSSPageSize: true,
        printBackground: true,
        pageRanges: "1", // guard against a rounding-induced trailing blank page
      });
      return Buffer.from(pdf);
    }

    await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
    // Bounded exactly like the laptop path: an unbounded fonts.ready let a
    // hung font fetch hold the render open until the 120s protocol timeout,
    // and a document printed in the fallback face beats a document that never
    // arrives.
    await step("fonts", () =>
      page.evaluate(
        (ms: number) =>
          Promise.race([
            (document as Document & { fonts: FontFaceSet }).fonts.ready,
            new Promise((r) => setTimeout(r, ms)),
          ]),
        FONT_WAIT_MS,
      ),
    );
    const pdf = await page.pdf({ format: "A4", printBackground: true });
    return Buffer.from(pdf);
  } finally {
    // Close the PAGE, not the browser: the browser outlives this render now.
    // A page that cannot be closed means the browser is gone, which withBrowser
    // handles; it must not mask the render's own outcome.
    try {
      await page.close();
    } catch {
      /* the browser is already gone */
    }
  }
}

/** Render several documents through ONE browser. Pages are rendered in series
 *  on purpose: three tall laptop captures in parallel is how a 1GB serverless
 *  sandbox runs Chromium out of memory, and the launch, not the render, was
 *  the cost worth removing (LC-032). */
export async function renderPdfBatch(items: readonly RenderPdfItem[]): Promise<Buffer[]> {
  if (items.length === 0) return [];
  return withBrowser(async (browser) => {
    const out: Buffer[] = [];
    for (const item of items) out.push(await renderOnPage(browser, item.html, item.opts ?? {}));
    return out;
  });
}

/** Render one document. Unchanged for every existing caller: same signature,
 *  same options, same Buffer out. What changed is underneath, it now shares
 *  the warm browser rather than launching its own. */
export async function renderPdf(html: string, opts: RenderPdfOptions = {}): Promise<Buffer> {
  return withBrowser((browser) => renderOnPage(browser, html, opts));
}

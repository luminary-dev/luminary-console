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

/** Laptop viewport width the design is laid out at before capture. */
const LAPTOP_WIDTH = 1280;

/** PDF page dimensions are limited to ~200in (14400px) per the spec; keep a
 *  margin under it so a very long page still produces a valid single-page PDF
 *  instead of failing outright. */
const MAX_PAGE_PX = 14000;

export type RenderPdfOptions = {
  /** Capture the page at laptop width as a single full-height page (see above). */
  laptop?: boolean;
};

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
    page.evaluate(() =>
      Promise.race([
        (document as Document & { fonts: FontFaceSet }).fonts.ready,
        new Promise((r) => setTimeout(r, 20_000)),
      ]),
    ),
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function renderPdf(html: string, opts: RenderPdfOptions = {}): Promise<Buffer> {
  const puppeteer = await import("puppeteer-core");
  let browser;
  if (process.env.VERCEL) {
    const chromium = (await import("@sparticuz/chromium")).default;
    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
      protocolTimeout: 120_000,
    });
  } else {
    browser = await puppeteer.launch({
      executablePath:
        process.env.CHROME_PATH ||
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      headless: true,
      protocolTimeout: 120_000,
    });
  }
  try {
    const page = await browser.newPage();
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
      const pdf = await page.pdf({
        width: `${LAPTOP_WIDTH}px`,
        height: `${Math.min(Math.max(height, 200), MAX_PAGE_PX)}px`,
        printBackground: true,
        pageRanges: "1", // guard against a rounding-induced trailing blank page
      });
      return Buffer.from(pdf);
    }

    await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
    await page.evaluate(() => (document as Document & { fonts: FontFaceSet }).fonts.ready);
    const pdf = await page.pdf({ format: "A4", printBackground: true });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

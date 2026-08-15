// HTML → PDF via headless Chromium (@sparticuz/chromium on Vercel, system
// Chrome locally). Same proven setup as the questionnaire app.
//
// Two modes:
//  - default (documents): A4 print pages, print stylesheet.
//  - laptop (design previews): render at a desktop viewport and emit ONE page
//    sized to the full scroll height, using the *screen* stylesheet — so the
//    PDF looks like the site does on a laptop, top to bottom, not a narrow A4
//    reflow that triggers mobile breakpoints. Before capturing it fully
//    "hydrates" the page: waits for the network to settle, scrolls the whole
//    document to fire lazy-loading and scroll-reveal animations, forces any
//    still-hidden reveal elements visible, eager-loads images, and waits for
//    fonts + images to finish — otherwise the snapshot shows placeholder
//    images and missing (opacity:0, not-yet-revealed) text.

/** Laptop viewport width the design is laid out at before capture. Wide enough
 *  that responsive sites render their desktop layout, matching how a client
 *  sees the concept on a laptop. */
const LAPTOP_WIDTH = 1280;

/** PDF page dimensions are limited to ~200in (14400px) per the spec; keep a
 *  margin under it so a very long page still produces a valid single-page PDF
 *  instead of failing outright. */
const MAX_PAGE_PX = 14000;

export type RenderPdfOptions = {
  /** Capture the page at laptop width as a single full-height page (see above). */
  laptop?: boolean;
};

// Scroll the whole document in steps so IntersectionObserver reveals and lazy
// images trigger, then return to the top. Runs in the page context.
/* eslint-disable @typescript-eslint/no-explicit-any */
async function hydrateForCapture(page: any): Promise<void> {
  // Neutralise animations/transitions and force common scroll-reveal patterns
  // visible, so nothing is captured mid-animation or left hidden.
  await page.addStyleTag({
    content: `*,*::before,*::after{
        animation:none!important;transition:none!important;
        animation-delay:0s!important;transition-delay:0s!important;
        scroll-behavior:auto!important;}
      [data-aos],.aos-init,.aos-animate,.wow,.reveal,.fade-in,.fade-up,
      [data-animate],[data-scroll],.animate,.animated,.is-inview,.gsap-reveal{
        opacity:1!important;transform:none!important;visibility:visible!important;
        filter:none!important;clip-path:none!important;}
      html,body{overflow:visible!important;}`,
  });

  // Walk the page top-to-bottom to fire lazy-load / on-scroll behaviour.
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let last = 0;
      const step = 500;
      const timer = setInterval(() => {
        window.scrollBy(0, step);
        const h = document.body.scrollHeight;
        if (window.scrollY + window.innerHeight >= h || window.scrollY === last) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
        last = window.scrollY;
      }, 60);
    });
  });

  // Eager-load images (including data-src/data-srcset lazy patterns) and wait
  // for every image to settle so none render as a placeholder.
  await page.evaluate(async () => {
    const imgs = Array.from(document.images) as HTMLImageElement[];
    for (const img of imgs) {
      img.loading = "eager";
      const ds = img.getAttribute("data-src");
      if (ds && !img.currentSrc) img.src = ds;
      const dss = img.getAttribute("data-srcset");
      if (dss && !img.srcset) img.srcset = dss;
    }
    await Promise.all(
      imgs
        .filter((i) => !i.complete)
        .map((i) => new Promise<void>((r) => {
          i.addEventListener("load", () => r(), { once: true });
          i.addEventListener("error", () => r(), { once: true });
        })),
    );
  });

  await page.evaluate(() => (document as Document & { fonts: FontFaceSet }).fonts.ready);
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
    });
  } else {
    browser = await puppeteer.launch({
      executablePath:
        process.env.CHROME_PATH ||
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      headless: true,
    });
  }
  try {
    const page = await browser.newPage();
    if (opts.laptop) {
      await page.setViewport({ width: LAPTOP_WIDTH, height: 800, deviceScaleFactor: 2 });
      // Render what the client sees on screen, not any @media print rules.
      await page.emulateMediaType("screen");
      // networkidle0: wait for external images/fonts/CSS to finish loading.
      // (Supported at runtime; puppeteer's setContent type omits it, hence the
      // cast to the method's own options type.)
      await page.setContent(html, { waitUntil: "networkidle0", timeout: 60_000 } as unknown as Parameters<
        typeof page.setContent
      >[1]);
      await hydrateForCapture(page);

      // One page as tall as the whole (now fully loaded) document.
      const height = await page.evaluate(() =>
        Math.ceil(
          Math.max(
            document.documentElement.scrollHeight,
            document.body?.scrollHeight ?? 0,
          ),
        ),
      );
      const pdf = await page.pdf({
        width: `${LAPTOP_WIDTH}px`,
        height: `${Math.min(height, MAX_PAGE_PX)}px`,
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

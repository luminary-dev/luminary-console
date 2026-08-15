// HTML → PDF via headless Chromium (@sparticuz/chromium on Vercel, system
// Chrome locally). Same proven setup as the questionnaire app.
//
// Two modes:
//  - default (documents): A4 print pages, print stylesheet.
//  - laptop (design previews): render at a desktop viewport and emit ONE page
//    sized to the full scroll height, using the *screen* stylesheet — so the
//    PDF looks like the site does on a laptop, top to bottom, not a narrow A4
//    reflow that triggers mobile breakpoints.

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
    }
    await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
    await page.evaluate(() => (document as Document & { fonts: FontFaceSet }).fonts.ready);

    if (opts.laptop) {
      // One page as tall as the whole document, at laptop width.
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

    const pdf = await page.pdf({ format: "A4", printBackground: true });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

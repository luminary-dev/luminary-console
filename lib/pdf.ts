// HTML → A4 PDF via headless Chromium (@sparticuz/chromium on Vercel,
// system Chrome locally). Same proven setup as the questionnaire app.
export async function renderPdf(html: string): Promise<Buffer> {
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
    await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
    await page.evaluate(() => (document as Document & { fonts: FontFaceSet }).fonts.ready);
    const pdf = await page.pdf({ format: "A4", printBackground: true });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

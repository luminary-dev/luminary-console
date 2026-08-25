// LC-032: every document render launched a fresh headless Chromium, and
// stage 2 launched three in series.
//
// What has to hold now: a batch goes through ONE browser, sequential renders
// reuse the warm one, and a handle that died while the instance was frozen is
// recovered from rather than thrown at the caller. The last part is the one
// worth being careful about, because a serverless function is frozen and
// thawed underneath a module-scope browser, and a dead browser that still
// claims to be connected is exactly what that produces.
//
// puppeteer-core and @sparticuz/chromium are mocked: no unit test may launch a
// real browser.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { atIndex } from "./helpers";

type FakePage = {
  setViewport: () => Promise<void>;
  emulateMediaType: () => Promise<void>;
  setContent: () => Promise<void>;
  addStyleTag: () => Promise<void>;
  evaluate: () => Promise<number>;
  pdf: () => Promise<Uint8Array>;
  close: () => Promise<void>;
};

type FakeBrowser = {
  connected: boolean;
  /** Message this browser's newPage() throws with, if any. Per-instance, so a
   *  fault can be pinned to the handle that died without following the
   *  replacement. */
  newPageError: string | null;
  newPage: () => Promise<FakePage>;
  close: () => Promise<void>;
};

const chromium = vi.hoisted(() => {
  const state = {
    launches: 0,
    options: [] as Record<string, unknown>[],
    browsers: [] as FakeBrowser[],
    pagesOpened: 0,
    pagesClosed: 0,
    /** Message page.pdf() throws with, if any. */
    pdfError: null as string | null,
  };

  const makeBrowser = (): FakeBrowser => {
    const browser: FakeBrowser = {
      connected: true,
      newPageError: null,
      async newPage() {
        if (browser.newPageError) throw new Error(browser.newPageError);
        if (!browser.connected) throw new Error("Protocol error: Target closed.");
        state.pagesOpened++;
        return {
          setViewport: async () => {},
          emulateMediaType: async () => {},
          setContent: async () => {},
          addStyleTag: async () => {},
          evaluate: async () => 1000,
          pdf: async () => {
            if (state.pdfError) throw new Error(state.pdfError);
            return new Uint8Array([0x25, 0x50, 0x44, 0x46]);
          },
          close: async () => {
            state.pagesClosed++;
          },
        };
      },
      async close() {
        browser.connected = false;
      },
    };
    return browser;
  };

  return {
    state,
    reset() {
      state.launches = 0;
      state.options = [];
      state.browsers = [];
      state.pagesOpened = 0;
      state.pagesClosed = 0;
      state.pdfError = null;
    },
    async launch(options: Record<string, unknown>) {
      state.launches++;
      state.options.push(options);
      const browser = makeBrowser();
      state.browsers.push(browser);
      return browser;
    },
  };
});

vi.mock("puppeteer-core", () => ({
  launch: chromium.launch,
  default: { launch: chromium.launch },
}));

vi.mock("@sparticuz/chromium", () => ({
  default: {
    args: ["--sparticuz-arg"],
    executablePath: async () => "/tmp/serverless-chromium",
  },
}));

const { renderPdf, renderPdfBatch, shutdownPdfBrowser } = await import("@/lib/pdf");

const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46]);

beforeEach(async () => {
  await shutdownPdfBrowser();
  chromium.reset();
  delete process.env.VERCEL;
  process.env.CHROME_PATH = "/tmp/chrome";
});

afterEach(async () => {
  // Never leave a warm browser (real or fake) behind for the next test.
  await shutdownPdfBrowser();
});

describe("renderPdfBatch", () => {
  it("LC-032: renders a batch through one browser rather than one per document", async () => {
    const out = await renderPdfBatch([
      { html: "<p>quotation</p>" },
      { html: "<p>proposal</p>" },
      { html: "<p>contract</p>" },
    ]);

    expect(out).toHaveLength(3);
    for (const pdf of out) expect(pdf).toEqual(PDF_MAGIC);
    // The whole finding: three documents, one Chromium.
    expect(chromium.state.launches).toBe(1);
    // One page per document, and every one of them closed.
    expect(chromium.state.pagesOpened).toBe(3);
    expect(chromium.state.pagesClosed).toBe(3);
  });

  it("LC-032: an empty batch launches nothing", async () => {
    expect(await renderPdfBatch([])).toEqual([]);
    expect(chromium.state.launches).toBe(0);
  });

  it("LC-032: separate renderPdf calls reuse the warm browser", async () => {
    await renderPdf("<p>one</p>");
    await renderPdf("<p>two</p>", { laptop: true });
    expect(chromium.state.launches).toBe(1);
    expect(chromium.state.pagesOpened).toBe(2);
  });
});

describe("warm browser recovery", () => {
  it("LC-032: a browser that died while the instance was frozen is relaunched, not thrown", async () => {
    await renderPdf("<p>first</p>");
    expect(chromium.state.launches).toBe(1);

    // Freeze/thaw: the child process is gone but the handle still says it is
    // connected, so the failure only shows up on first use. The fault is
    // pinned to this handle, so the replacement launches healthy.
    const first = atIndex(chromium.state.browsers, 0);
    first.newPageError = "Protocol error: Connection closed.";
    expect(first.connected).toBe(true);

    const pdf = await renderPdf("<p>second</p>");
    expect(pdf).toEqual(PDF_MAGIC);
    expect(chromium.state.launches).toBe(2);
    // The corpse was closed rather than leaked.
    expect(first.connected).toBe(false);
  });

  it("LC-032: a handle that reports itself disconnected is replaced before it is used", async () => {
    await renderPdf("<p>first</p>");
    const first = atIndex(chromium.state.browsers, 0);
    // A clean close from the other side (an idle shutdown that raced us).
    await first.close();
    expect(first.connected).toBe(false);

    const pdf = await renderPdf("<p>second</p>");
    expect(pdf).toEqual(PDF_MAGIC);
    expect(chromium.state.launches).toBe(2);
  });

  it("LC-032: a render that fails on its own merits surfaces unchanged, with no relaunch", async () => {
    chromium.state.pdfError = "Page crashed while printing this document";
    await expect(renderPdf("<p>bad</p>")).rejects.toThrow("Page crashed while printing this document");
    // One launch: a document-level failure must not be retried on a new
    // browser, or every genuine error costs a Chromium cold start.
    expect(chromium.state.launches).toBe(1);
  });
});

describe("launch paths", () => {
  it("LC-032: uses system Chrome locally and @sparticuz/chromium on Vercel", async () => {
    await renderPdf("<p>local</p>");
    expect(atIndex(chromium.state.options, 0).executablePath).toBe("/tmp/chrome");

    await shutdownPdfBrowser();
    process.env.VERCEL = "1";
    await renderPdf("<p>serverless</p>");
    expect(atIndex(chromium.state.options, 1).executablePath).toBe("/tmp/serverless-chromium");
    expect(atIndex(chromium.state.options, 1).args).toEqual(["--sparticuz-arg"]);
  });
});

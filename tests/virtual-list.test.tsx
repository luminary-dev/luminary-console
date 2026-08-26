// @vitest-environment jsdom
//
// LC-030 (list surfaces are O(N) with no pagination or virtualization) and the
// batch-read half of LC-033.
//
// Two things are under test. First the table: above the 100-row threshold only
// a window of rows may exist in the DOM, but the full count and each row's
// position have to keep reaching assistive tech, the existing sort has to keep
// working, and every row has to stay reachable from the keyboard. Below the
// threshold nothing changes at all. Second the store: the helper every list
// surface now reads through must bound its fan-out instead of opening one
// connection per client.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ClientTable, { type ClientRow } from "@/components/ClientTable";
import { VIRTUALIZE_THRESHOLD } from "@/components/VirtualList";
import { atIndex } from "./helpers";

// The store is imported for the LC-033 block; the S3 client underneath it is
// replaced with an in-memory one that reports how many reads overlapped.
const s3 = vi.hoisted(() => {
  const state = { inFlight: 0, peak: 0, calls: 0 };
  return {
    state,
    reset() {
      state.inFlight = 0;
      state.peak = 0;
      state.calls = 0;
    },
    async send(command: { input: { Key?: string } }) {
      state.calls++;
      state.inFlight++;
      state.peak = Math.max(state.peak, state.inFlight);
      // A real round trip; without one every read would resolve before the
      // next started and the peak would be 1 no matter what the code does.
      await new Promise((r) => setTimeout(r, 2));
      state.inFlight--;
      return {
        ETag: '"etag"',
        ContentType: "application/json",
        Body: { transformToString: async () => JSON.stringify({ slug: command.input.Key }) },
      };
    },
  };
});

vi.mock("@aws-sdk/client-s3", () => {
  class Command {
    constructor(public input: Record<string, unknown>) {}
  }
  return {
    S3Client: class {
      send = s3.send;
    },
    GetObjectCommand: Command,
    PutObjectCommand: Command,
    DeleteObjectCommand: Command,
    DeleteObjectsCommand: Command,
    ListObjectsV2Command: Command,
  };
});

afterEach(cleanup);

// ——— fixtures ———

const row = (n: number): ClientRow => ({
  slug: `client-${String(n).padStart(4, "0")}`,
  // Company names are shuffled against creation order (397 is coprime with
  // 1000, so this is a bijection), which is what makes a sort by client
  // visibly different from the default sort by date.
  company: `Company ${String((n * 397) % 1000).padStart(4, "0")}`,
  docNoBase: String(1000 + n),
  status: "created",
  statusLabel: "Estimate sent",
  stage: "lead",
  createdAt: new Date(Date.UTC(2026, 0, 1) + n * 86_400_000).toISOString(),
  outstanding: n % 3 === 0 ? n * 100 : 0,
  overdue: false,
});

const rows = (count: number): ClientRow[] => Array.from({ length: count }, (_, i) => row(i));

const LARGE = rows(1000);
const SMALL = rows(40);
/** The table's default sort is newest first, so this is the order on screen. */
const ORDERED = [...LARGE].reverse();
/** Alphabetically first company: the n=0 row, which sorts LAST by date. */
const ALPHA_FIRST = atIndex(LARGE, 0).company;

/** Rendered data rows: the spacers are aria-hidden, so they are not rows. */
const dataRows = () => screen.getAllByRole("row").slice(1);
const firstCells = () => dataRows().map((r) => atIndex(within(r).getAllByRole("cell"), 0).textContent);
const scroller = () => document.querySelector(".table-scroll") as HTMLElement;

/** jsdom has no layout, so scrollTop is permanently 0 unless it is defined. */
function scrollTo(px: number) {
  const el = scroller();
  Object.defineProperty(el, "scrollTop", { value: px, writable: true, configurable: true });
  fireEvent.scroll(el);
}

describe("ClientTable virtualization", () => {
  it("LC-030: a 1,000-row list renders only a window but reports the whole list to assistive tech", () => {
    render(<ClientTable rows={LARGE} />);

    const rendered = dataRows();
    expect(rendered.length).toBeGreaterThan(0);
    // The window is a screenful plus overscan, nowhere near the whole list.
    expect(rendered.length).toBeLessThan(60);

    const table = screen.getByRole("table");
    expect(table.getAttribute("aria-rowcount")).toBe("1001");
    // Row 1 is the header, so the first data row is row 2.
    expect(atIndex(rendered, 0).getAttribute("aria-rowindex")).toBe("2");

    // The live region counts the list, not the window.
    const live = document.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toContain("1000 of 1000 clients shown");
  });

  it("LC-030: scrolling moves the window instead of growing the DOM", () => {
    render(<ClientTable rows={LARGE} />);
    const before = dataRows().length;
    expect(firstCells()[0]).toBe(atIndex(ORDERED, 0).company);

    scrollTo(400 * 44);

    const after = dataRows();
    expect(after.length).toBeLessThanOrEqual(before + 1);
    // We are deep in the list now, and the top rows are gone from the DOM.
    expect(screen.queryByText(atIndex(ORDERED, 0).company)).toBeNull();
    const index = Number(atIndex(after, 0).getAttribute("aria-rowindex"));
    expect(index).toBeGreaterThan(300);
  });

  it("LC-030: below the threshold every row renders, with no spacers", () => {
    render(<ClientTable rows={SMALL} />);
    expect(SMALL.length).toBeLessThan(VIRTUALIZE_THRESHOLD);
    expect(dataRows()).toHaveLength(SMALL.length);
    expect(document.querySelectorAll("tbody tr[aria-hidden='true']")).toHaveLength(0);
    expect(screen.getByRole("table").getAttribute("aria-rowcount")).toBe("41");
  });

  it("LC-030/LC-041: sorting a virtualized list still works and still announces aria-sort", async () => {
    const user = userEvent.setup();
    render(<ClientTable rows={LARGE} />);

    expect(firstCells()[0]).toBe(atIndex(ORDERED, 0).company);

    const header = screen.getByRole("columnheader", { name: "Client" });
    await user.click(within(header).getByRole("button"));

    expect(header.getAttribute("aria-sort")).toBe("ascending");
    expect(firstCells()[0]).toBe(ALPHA_FIRST);
    // Still a window, not the whole list.
    expect(dataRows().length).toBeLessThan(60);
  });

  it("LC-030: filtering a virtualized list down below the threshold renders it whole", async () => {
    const user = userEvent.setup();
    render(<ClientTable rows={LARGE} />);
    // Company names are unique, so a whole one matches exactly one client.
    await user.type(screen.getByRole("searchbox"), atIndex(LARGE, 123).company);
    expect(dataRows()).toHaveLength(1);
    expect(screen.getByRole("table").getAttribute("aria-rowcount")).toBe("2");
  });

  it("LC-030: arrow keys, Home and End reach rows that are outside the window", async () => {
    render(<ClientTable rows={LARGE} />);

    const firstLink = within(atIndex(dataRows(), 0)).getByRole("link");
    firstLink.focus();
    expect(document.activeElement).toBe(firstLink);

    // Down moves to the next row's link.
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowDown" });
    expect((document.activeElement as HTMLElement).textContent).toContain(atIndex(ORDERED, 1).company);

    // End reaches the last row of a thousand, which was not rendered a moment
    // ago: the window follows focus rather than trapping it at the top.
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "End" });
    const last = document.activeElement as HTMLElement;
    expect(last.textContent).toContain(atIndex(ORDERED, ORDERED.length - 1).company);
    expect(last.closest("tr")?.getAttribute("aria-rowindex")).toBe(String(LARGE.length + 1));

    // And back to the top.
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Home" });
    expect((document.activeElement as HTMLElement).textContent).toContain(atIndex(ORDERED, 0).company);
  });
});

// ——— LC-033 / LC-030: bounded batch reads ———

describe("store batch reads", () => {
  beforeEach(() => {
    s3.reset();
  });

  it("LC-033: mapLimit never runs more than `limit` at once and keeps input order", async () => {
    const { mapLimit } = await import("@/lib/store");
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 50 }, (_, i) => i);

    const out = await mapLimit(items, 4, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return n * 2;
    });

    expect(peak).toBe(4);
    expect(out).toEqual(items.map((n) => n * 2));
  });

  it("LC-033: getClients bounds the fan-out instead of opening one read per client", async () => {
    const { getClients, READ_CONCURRENCY } = await import("@/lib/store");
    // Distinct slugs: the store's 5s read cache would otherwise collapse them.
    const slugs = Array.from({ length: 200 }, (_, i) => `bounded-${i}`);

    const records = await getClients(slugs);

    expect(records).toHaveLength(slugs.length);
    expect(s3.state.calls).toBe(slugs.length);
    expect(s3.state.peak).toBeLessThanOrEqual(READ_CONCURRENCY);
    expect(s3.state.peak).toBeGreaterThan(1); // still parallel, just bounded
  });

  it("LC-033: a smaller limit is honoured", async () => {
    const { getClients } = await import("@/lib/store");
    await getClients(Array.from({ length: 30 }, (_, i) => `narrow-${i}`), 2);
    expect(s3.state.peak).toBe(2);
  });
});

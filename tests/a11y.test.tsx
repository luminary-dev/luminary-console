// @vitest-environment jsdom
// Accessibility and correctness regressions for the console shell:
// LC-022 (stale palette responses), LC-041 (keyboard-operable sorting),
// LC-042 (skip link), LC-043 (dialog focus trap and focus return).
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ClientTable, { type ClientRow } from "@/components/ClientTable";
import CommandPalette from "@/components/CommandPalette";
import { useConfirm } from "@/components/ConfirmDialog";
import SkipLink, { MAIN_ID } from "@/components/SkipLink";
import { atIndex } from "./helpers";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ——— LC-041 ———

const ROWS: ClientRow[] = [
  {
    slug: "eco-mech", company: "Ecomech", docNoBase: "LUM-0001", status: "live",
    statusLabel: "Live", stage: "development", createdAt: "2026-01-05T00:00:00.000Z",
    outstanding: 0, overdue: false,
  },
  {
    slug: "aurora", company: "Aurora Foods", docNoBase: "LUM-0002", status: "created",
    statusLabel: "Created", stage: "lead", createdAt: "2026-02-05T00:00:00.000Z",
    outstanding: 120_000, overdue: true,
  },
];

const clientCells = () =>
  screen.getAllByRole("row").slice(1).map((r) => atIndex(within(r).getAllByRole("cell"), 0).textContent);

describe("ClientTable sorting", () => {
  it("LC-041: the sort control is reachable and operable by keyboard and exposes aria-sort", async () => {
    const user = userEvent.setup();
    render(<ClientTable rows={ROWS} />);

    const header = screen.getByRole("columnheader", { name: "Client" });
    expect(header.getAttribute("aria-sort")).toBe("none");

    const control = within(header).getByRole("button");
    // Tab reaches it: the search box comes first, then the stage filters, then
    // the header controls.
    await user.tab();
    while (document.activeElement !== control) await user.tab();
    expect(document.activeElement).toBe(control);

    await user.keyboard("{Enter}");
    expect(header.getAttribute("aria-sort")).toBe("ascending");
    expect(clientCells()).toEqual(["Aurora Foods", "Ecomech"]);

    // Space toggles direction on a native button too.
    await user.keyboard(" ");
    expect(header.getAttribute("aria-sort")).toBe("descending");
    expect(clientCells()).toEqual(["Ecomech", "Aurora Foods"]);
  });

  it("LC-043: the row count is announced in a live region", () => {
    render(<ClientTable rows={ROWS} />);
    const live = document.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toContain("2 of 2 clients shown");
  });
});

// ——— LC-042 ———

describe("SkipLink", () => {
  it("LC-042: renders a link that points at the page's main content", () => {
    render(<SkipLink />);
    const link = screen.getByRole("link", { name: "Skip to content" });
    expect(link.getAttribute("href")).toBe(`#${MAIN_ID}`);
    expect(link.className).toBe("skip-link");
  });
});

// ——— LC-022 ———

type Deferred = { resolve: (hits: { slug: string; company: string; where: string; snippet: string }[]) => void };

describe("CommandPalette content search", () => {
  it("LC-022: a stale in-flight response cannot overwrite a newer query's results", async () => {
    vi.useFakeTimers();
    const pending = new Map<string, Deferred>();
    vi.stubGlobal("fetch", (url: string) => {
      const q = new URL(url, "http://console.test").searchParams.get("q") ?? "";
      return new Promise((resolve) => {
        pending.set(q, { resolve: (hits) => resolve({ ok: true, json: async () => ({ results: hits }) }) });
      });
    });

    // items is empty so nothing is a name match: every option on screen comes
    // from the content search.
    render(<CommandPalette items={[]} />);
    act(() => { fireEvent.keyDown(window, { key: "k", metaKey: true }); });

    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "old" } });
    await act(async () => { vi.advanceTimersByTime(250); });
    expect(pending.has("old")).toBe(true);

    fireEvent.change(input, { target: { value: "new" } });
    await act(async () => { vi.advanceTimersByTime(250); });
    expect(pending.has("new")).toBe(true);

    // The newer query lands first, then the slow earlier one resolves.
    await act(async () => {
      pending.get("new")!.resolve([{ slug: "newco", company: "New Co", where: "notes", snippet: "newest" }]);
    });
    expect(screen.getByText("New Co")).toBeTruthy();

    await act(async () => {
      pending.get("old")!.resolve([{ slug: "oldco", company: "Old Co", where: "notes", snippet: "stale" }]);
    });
    expect(screen.queryByText("Old Co")).toBeNull();
    expect(screen.getByText("New Co")).toBeTruthy();
  });

  it("LC-043: arrow keys move aria-activedescendant across both result groups", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({ results: [{ slug: "deep", company: "Deep Co", where: "quotation", snippet: "found" }] }),
    }));

    render(<CommandPalette items={[{ slug: "top", company: "Top Co", docNoBase: "LUM-0009" }]} />);
    act(() => { fireEvent.keyDown(window, { key: "k", metaKey: true }); });

    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "co" } });
    await act(async () => { vi.advanceTimersByTime(250); });

    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Top CoLUM-0009", "Deep Coquotationfound"]);
    expect(input.getAttribute("aria-activedescendant")).toBe(atIndex(options, 0).id);

    // The content hits below the name matches used to be unreachable.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(atIndex(options, 1).id);
    expect(atIndex(options, 1).getAttribute("aria-selected")).toBe("true");
  });
});

// ——— LC-043 ———

function ConfirmHarness() {
  const { confirm, dialog } = useConfirm();
  return (
    <>
      <button type="button" onClick={() => { void confirm({ title: "Delete Ecomech", message: "This cannot be undone." }); }}>
        Open
      </button>
      <button type="button">Elsewhere</button>
      {dialog}
    </>
  );
}

describe("ConfirmDialog", () => {
  it("LC-043: traps focus inside the open dialog and returns it to the trigger on close", async () => {
    const user = userEvent.setup();
    render(<ConfirmHarness />);

    const trigger = screen.getByRole("button", { name: "Open" });
    await user.click(trigger);

    const modal = screen.getByRole("dialog");
    expect(modal.getAttribute("aria-modal")).toBe("true");
    expect(modal.getAttribute("aria-labelledby")).toBeTruthy();

    const cancel = within(modal).getByRole("button", { name: "Cancel" });
    const ok = within(modal).getByRole("button", { name: "Confirm" });
    expect(document.activeElement).toBe(ok);

    // Four tabs in either direction never leave the dialog.
    for (let i = 0; i < 4; i++) {
      await user.tab();
      expect(modal.contains(document.activeElement)).toBe(true);
    }
    await user.tab({ shift: true });
    expect(modal.contains(document.activeElement)).toBe(true);
    expect([cancel, ok]).toContain(document.activeElement);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

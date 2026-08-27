// @vitest-environment jsdom
// Overlay primitives: the focus trap, the background scroll lock and the
// focus return that every modal in the console shares
// (components/useOverlayBehaviour.ts).
//
// IX-004 focus was not trapped, IX-005 nothing locked the background,
// IX-006 focus did not come back to the trigger. All three were fixed once,
// in the shared hook, so the tests below drive both consumers of it: the
// confirmation dialog and the command palette.
//
// jsdom cannot lay out or scroll, so what it can prove is the wiring: which
// element ends up focused, which inline styles are set and released, and what
// the live region says. The measurements that need a real engine are in
// tests/interaction/overlay.spec.ts.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import CommandPalette, { type PaletteItem } from "@/components/CommandPalette";
import { useConfirm, type ConfirmOptions } from "@/components/ConfirmDialog";
import { focusStops } from "@/components/useOverlayBehaviour";
import { MAIN_ID } from "@/components/SkipLink";
import { atIndex } from "./helpers";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const ANNOUNCER_ID = "overlay-focus-announcer";

beforeEach(() => {
  // The palette's content search is not the subject here; keep it silent.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ results: [] }), { status: 200 })),
  );
});

afterEach(() => {
  cleanup();
  document.getElementById(ANNOUNCER_ID)?.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ——— harnesses ———

/** A page with something focusable behind the overlay, which is what a leaking
 *  trap escapes onto. */
function Background() {
  return (
    <main id={MAIN_ID} tabIndex={-1}>
      <button type="button">Behind the veil</button>
      <a href="/somewhere">A link behind the veil</a>
    </main>
  );
}

function ConfirmHarness({ options }: { options: ConfirmOptions }) {
  const { confirm, dialog } = useConfirm();
  const [answer, setAnswer] = useState<string | null>(null);
  return (
    <>
      <Background />
      <button
        type="button"
        onClick={() => {
          void confirm(options).then(setAnswer);
        }}
      >
        Open
      </button>
      <span data-testid="answer">{answer ?? "pending"}</span>
      {dialog}
    </>
  );
}

/** The trigger disappears the moment it opens the dialog, which is the case
 *  where focus has to land somewhere sensible instead. */
function VanishingTriggerHarness() {
  const { confirm, dialog } = useConfirm();
  const [gone, setGone] = useState(false);
  return (
    <>
      <Background />
      {!gone && (
        <button
          type="button"
          onClick={() => {
            setGone(true);
            void confirm({ title: "Still there?", message: "The trigger is not." });
          }}
        >
          Open
        </button>
      )}
      {dialog}
    </>
  );
}

function TwoDialogHarness() {
  const a = useConfirm();
  const b = useConfirm();
  return (
    <>
      <Background />
      <button type="button" onClick={() => void a.confirm({ title: "First", message: "one" })}>
        Open first
      </button>
      <button type="button" onClick={() => void b.confirm({ title: "Second", message: "two" })}>
        Open second
      </button>
      {a.dialog}
      {b.dialog}
    </>
  );
}

const ITEMS: PaletteItem[] = [
  { slug: "eco-mech", company: "Ecomech", docNoBase: "LUM-0001" },
  { slug: "aurora", company: "Aurora Foods", docNoBase: "LUM-0002" },
  { slug: "borealis", company: "Borealis Studio", docNoBase: "LUM-0003" },
];

/** Cmd-K, from wherever focus happens to be. */
async function openPalette(): Promise<HTMLElement> {
  await act(async () => {
    fireEvent.keyDown(window, { key: "k", metaKey: true });
  });
  const dialog = await screen.findByRole("dialog");
  // The input is focused on the next frame.
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  return dialog;
}

// ——— IX-004: the focus trap ———

describe("IX-004: focus is trapped inside the overlay", () => {
  it("wraps Tab from the last stop to the first and Shift+Tab from the first to the last", async () => {
    const user = userEvent.setup();
    render(<ConfirmHarness options={{ title: "Wrap", message: "Cycle through me." }} />);
    await user.click(screen.getByRole("button", { name: "Open" }));

    const modal = screen.getByRole("dialog");
    const cancel = within(modal).getByRole("button", { name: "Cancel" });
    const ok = within(modal).getByRole("button", { name: "Confirm" });
    expect(focusStops(modal)).toEqual([cancel, ok]);

    // Forward off the end.
    ok.focus();
    await user.tab();
    expect(document.activeElement).toBe(cancel);

    // Backward off the front.
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(ok);

    // And it holds: fifteen presses, the same walk the browser harness does.
    for (let i = 0; i < 15; i++) {
      await user.tab();
      expect(modal.contains(document.activeElement)).toBe(true);
    }
    for (let i = 0; i < 15; i++) {
      await user.tab({ shift: true });
      expect(modal.contains(document.activeElement)).toBe(true);
    }
  });

  it("never counts a disabled, hidden, aria-hidden or tabindex=-1 control as a stop", async () => {
    const user = userEvent.setup();
    render(
      <ConfirmHarness
        options={{
          title: "Decorated",
          message: (
            <>
              <span aria-hidden="true">
                <button type="button">Decoration</button>
              </span>
              <button type="button" hidden>
                Hidden
              </button>
              <button type="button" disabled>
                Switched off
              </button>
              <button type="button" tabIndex={-1}>
                Programmatic only
              </button>
            </>
          ),
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));

    const modal = screen.getByRole("dialog");
    const cancel = within(modal).getByRole("button", { name: "Cancel" });
    const ok = within(modal).getByRole("button", { name: "Confirm" });
    expect(focusStops(modal)).toEqual([cancel, ok]);

    // The veil's dismiss button sits outside the dialog and is aria-hidden and
    // tabindex=-1, so it is not a stop either.
    const veil = document.querySelector<HTMLElement>(".modal-veil");
    expect(veil).not.toBeNull();
    if (veil) expect(focusStops(veil)).toEqual([cancel, ok]);

    for (let i = 0; i < 8; i++) {
      await user.tab();
      expect([cancel, ok]).toContain(document.activeElement);
    }
  });

  it("recomputes the stops as the dialog's contents change", async () => {
    const user = userEvent.setup();
    render(
      <ConfirmHarness
        options={{ title: "Password", message: "Confirm with the console password.", password: true }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));

    const modal = screen.getByRole("dialog");
    const input = within(modal).getByLabelText("Console password");
    const cancel = within(modal).getByRole("button", { name: "Cancel" });
    const ok = within(modal).getByRole("button", { name: "Confirm" });

    // The primary action is disabled until the field has a value, so it is not
    // in the cycle yet: Tab off Cancel comes back round to the input.
    expect(ok.hasAttribute("disabled")).toBe(true);
    expect(focusStops(modal)).toEqual([input, cancel]);
    cancel.focus();
    await user.tab();
    expect(document.activeElement).toBe(input);

    await user.type(input, "hunter2");

    // A set captured when the dialog opened would still be two long here.
    expect(ok.hasAttribute("disabled")).toBe(false);
    expect(focusStops(modal)).toEqual([input, cancel, ok]);
    cancel.focus();
    await user.tab();
    expect(document.activeElement).toBe(ok);
    await user.tab();
    expect(document.activeElement).toBe(input);
  });

  it("keeps the palette's only stop reachable while its result list is rewritten", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Background />
        <CommandPalette items={ITEMS} />
      </>,
    );
    const dialog = await openPalette();
    const input = within(dialog).getByRole("combobox");
    expect(document.activeElement).toBe(input);

    // Full list.
    expect(within(dialog).getAllByRole("option")).toHaveLength(ITEMS.length);
    for (let i = 0; i < 5; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }

    // Filtered down to one, then to none: the trap follows.
    await user.type(input, "a");
    await waitFor(() =>
      expect(within(dialog).getAllByRole("option").length).toBeLessThan(ITEMS.length),
    );
    for (let i = 0; i < 5; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }

    await user.clear(input);
    await user.type(input, "zzzz");
    await waitFor(() => expect(within(dialog).queryAllByRole("option")).toHaveLength(0));
    for (let i = 0; i < 5; i++) {
      await user.tab({ shift: true });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });
});

// ——— IX-005: the scroll lock ———

describe("IX-005: the background is locked while an overlay is open", () => {
  it("locks the document and the body, then releases both", async () => {
    const user = userEvent.setup();
    const root = document.documentElement;
    expect(root.style.overflow).toBe("");
    expect(document.body.style.overflow).toBe("");

    render(<ConfirmHarness options={{ title: "Locked", message: "Nothing moves behind me." }} />);
    await user.click(screen.getByRole("button", { name: "Open" }));

    // The root is what actually stops the viewport; the body is where the
    // audit harness reads the lock from.
    expect(root.style.overflow).toBe("hidden");
    expect(document.body.style.overflow).toBe("hidden");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(root.style.overflow).toBe("");
    expect(document.body.style.overflow).toBe("");
    // No compensation is left behind either.
    expect(root.style.getPropertyValue("scrollbar-gutter")).toBe("");
    expect(root.style.getPropertyValue("border-right")).toBe("");
  });

  it("locks the palette's background too and releases it on Escape", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Background />
        <CommandPalette items={ITEMS} />
      </>,
    );
    await openPalette();
    expect(document.body.style.overflow).toBe("hidden");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.body.style.overflow).toBe("");
  });

  it("holds the lock until the last of two stacked overlays has closed", async () => {
    const user = userEvent.setup();
    render(<TwoDialogHarness />);

    await user.click(screen.getByRole("button", { name: "Open first" }));
    expect(document.body.style.overflow).toBe("hidden");

    // The first dialog traps focus, so the second is opened the way a nested
    // flow does it, by calling the trigger directly.
    fireEvent.click(screen.getByRole("button", { name: "Open second" }));
    await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(2));

    // Escape reaches the topmost overlay only.
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(1));
    expect(atIndex(screen.getAllByRole("dialog"), 0).textContent).toContain("First");
    expect(document.body.style.overflow).toBe("hidden");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.body.style.overflow).toBe("");
  });
});

// ——— IX-006: focus return ———

describe("IX-006: focus returns to the trigger", () => {
  it("returns to the trigger even when the click never focused it", async () => {
    render(<ConfirmHarness options={{ title: "Clicked", message: "By pointer, not by focus." }} />);
    const trigger = screen.getByRole("button", { name: "Open" });

    // WebKit does not focus a button on click, so document.activeElement is
    // still the body inside the handler that opens the dialog. Reproduced here
    // with fireEvent, which does not move focus either: reading activeElement
    // at that moment yields the body, and handing focus back to the body is
    // what left it there.
    expect(document.activeElement).toBe(document.body);
    fireEvent.mouseDown(trigger);
    fireEvent.click(trigger);

    const modal = await screen.findByRole("dialog");
    expect(modal.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
    expect(document.activeElement).not.toBe(document.body);
  });

  it("returns to the trigger after a keyboard-driven open and close", async () => {
    const user = userEvent.setup();
    render(<ConfirmHarness options={{ title: "Keyboard", message: "Opened with Enter." }} />);
    const trigger = screen.getByRole("button", { name: "Open" });
    trigger.focus();
    await user.keyboard("{Enter}");

    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("falls back to the main content, and says so, when the trigger has gone", async () => {
    const user = userEvent.setup();
    render(<VanishingTriggerHarness />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    await screen.findByRole("dialog");
    expect(screen.queryByRole("button", { name: "Open" })).toBeNull();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    const main = document.getElementById(MAIN_ID);
    expect(document.activeElement).toBe(main);
    expect(document.activeElement).not.toBe(document.body);

    const announcer = document.getElementById(ANNOUNCER_ID);
    expect(announcer?.getAttribute("aria-live")).toBe("polite");
    await waitFor(() =>
      expect(announcer?.textContent).toBe("The dialog closed and focus moved to the main content."),
    );
  });

  it("hands the palette's focus back to whatever had it before Cmd-K", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Background />
        <CommandPalette items={ITEMS} />
      </>,
    );
    const behind = screen.getByRole("button", { name: "Behind the veil" });
    behind.focus();

    await openPalette();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(behind);
  });

  it("never leaves focus on the body when the palette was opened from nowhere", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Background />
        <CommandPalette items={ITEMS} />
      </>,
    );
    expect(document.activeElement).toBe(document.body);

    await openPalette();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(document.getElementById(MAIN_ID));
  });
});

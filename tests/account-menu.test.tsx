// @vitest-environment jsdom
// The topbar's account disclosure (components/AccountMenu.tsx): it opens and
// closes, exposes its state to assistive tech, returns focus to the trigger on
// Escape, and closes on an outside click. This is the control that replaced the
// three stray topbar buttons that wrapped to a second row.
//
// No jest-dom in this repo, so assertions read the DOM directly.
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AccountMenu from "@/components/AccountMenu";

// PushToggle (rendered inside the panel) reads window.matchMedia on mount;
// jsdom does not implement it. With no serviceWorker and a non-iOS UA it
// resolves to "hidden" and renders nothing, so the panel is Settings + Sign out.
beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: false,
      media: "",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const trigger = () => screen.getByRole("button", { name: /account/i });

describe("AccountMenu", () => {
  it("is collapsed on first render, with the panel absent", () => {
    render(<AccountMenu />);
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
  });

  it("opens on click and reveals Settings and Sign out", async () => {
    const user = userEvent.setup();
    render(<AccountMenu />);
    await user.click(trigger());

    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/settings");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("hides the Settings item when showSettings is false", async () => {
    const user = userEvent.setup();
    render(<AccountMenu showSettings={false} />);
    await user.click(trigger());

    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<AccountMenu />);
    await user.click(trigger());
    expect(trigger().getAttribute("aria-expanded")).toBe("true");

    await user.keyboard("{Escape}");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger());
  });

  it("closes on a click outside the menu", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <AccountMenu />
        <button type="button">elsewhere</button>
      </div>,
    );
    await user.click(trigger());
    expect(trigger().getAttribute("aria-expanded")).toBe("true");

    await user.click(screen.getByRole("button", { name: "elsewhere" }));
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });
});

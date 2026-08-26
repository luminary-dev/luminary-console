// @vitest-environment jsdom
// LC-023: relative timestamps were computed once on the server with a fixed
// `now` and never ticked again. These cover both halves of the fix: the pure
// cadence helper in lib/time.ts, and the client component that must hydrate
// to exactly the server's label before it starts updating.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RelativeTime from "@/components/RelativeTime";
import { relTickMs, relTime, shortWhenLabel, whenLabel } from "@/lib/time";

const BASE = Date.parse("2026-08-26T10:00:00.000Z");
const ago = (ms: number) => new Date(BASE - ms).toISOString();

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("relTickMs", () => {
  it("LC-023: ticks fast while recent, slowly when old, and stops once fixed", () => {
    expect(relTickMs(ago(2 * 60_000), BASE)).toBe(15_000);
    expect(relTickMs(ago(3 * 3_600_000), BASE)).toBe(5 * 60_000);
    expect(relTickMs(ago(3 * 86_400_000), BASE)).toBe(3_600_000);
    // Past a fortnight relTime renders an absolute date, so there is nothing
    // left to re-derive.
    expect(relTickMs(ago(20 * 86_400_000), BASE)).toBeNull();
    expect(relTickMs("not a date", BASE)).toBeNull();
  });
});

describe("RelativeTime", () => {
  it("LC-023: first paint is exactly the server-rendered label", () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
    const at = ago(2 * 60_000);
    const serverLabel = relTime(at, BASE);
    expect(serverLabel).toBe("2m ago");

    // renderToStaticMarkup runs no effects, so this is the markup React
    // hydrates against: it must match the server byte for byte.
    const html = renderToStaticMarkup(createElement(RelativeTime, { at, initial: serverLabel }));
    expect(html).toContain(">2m ago<");
  });

  it("LC-023: the label keeps updating while the tab stays open", () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
    const at = ago(60_000);
    render(createElement(RelativeTime, { at, initial: relTime(at, BASE) }));
    expect(screen.getByText("1m ago")).toBeTruthy();

    act(() => { vi.advanceTimersByTime(5 * 60_000); });
    expect(screen.getByText("6m ago")).toBeTruthy();

    act(() => { vi.advanceTimersByTime(60 * 60_000); });
    expect(screen.getByText("1h ago")).toBeTruthy();
  });
});

describe("LC-087 timestamps are pinned to one timezone", () => {
  it("formats in Colombo time regardless of the runtime's zone", () => {
    // The bug: two components carried their own copy of this formatter with
    // no timeZone, so the SERVER rendered UTC and the BROWSER rendered the
    // viewer's local zone. Same instant, 18:23 against 23:53, which is a
    // React hydration mismatch and a timestamp readable five and a half hours
    // wrong. Asserted against an explicit instant so the expectation cannot
    // drift with the machine running the suite.
    const instant = "2026-08-15T18:23:00Z"; // 23:53 in Asia/Colombo
    expect(shortWhenLabel(instant)).toContain("23:53");
    expect(shortWhenLabel(instant)).toContain("15 Aug");
  });

  it("agrees with whenLabel on the hour, so the two clocks cannot diverge", () => {
    const instant = "2026-08-15T18:23:00Z";
    expect(whenLabel(instant)).toContain("23:53");
    expect(shortWhenLabel(instant)).toContain("23:53");
  });

  it("returns the input unchanged when it is not a date", () => {
    expect(shortWhenLabel("not a date")).toBe("not a date");
  });
});

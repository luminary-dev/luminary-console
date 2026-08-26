// @vitest-environment jsdom
// LC-021: the 25 to 30 minute questionnaire kept every answer in useState, so
// a refresh, a back-navigation or a crashed tab lost the lot. These cover the
// draft's whole life: saved, restored, scoped to one client, and cleared on
// submit, plus the private-mode case where localStorage throws.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import QuestionnaireForm from "@/components/QuestionnaireForm";
import type { Section } from "@/lib/questions";

const SECTIONS: Section[] = [
  {
    id: "you",
    eyebrow: "Before we start",
    title: "Who is filling this in",
    fields: [
      { id: "contactName", type: "text", label: "Your name", required: true },
      { id: "describe", type: "textarea", label: "Describe the project", required: true },
    ],
  },
];

const KEY = (slug: string) => `luminary-questionnaire-draft:${slug}`;
const DEBOUNCE = 600;

/** A localStorage the test fully controls, so the private-mode case can be
 *  reproduced exactly (every method throwing) rather than approximated. */
function installStorage(overrides: Partial<Storage> = {}): Storage {
  const map = new Map<string, string>();
  const store: Storage = {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => { map.delete(k); },
    setItem: (k: string, v: string) => { map.set(k, v); },
  };
  Object.assign(store, overrides);
  Object.defineProperty(window, "localStorage", { value: store, configurable: true, writable: true });
  return store;
}

function renderForm(slug: string) {
  return render(<QuestionnaireForm slug={slug} sections={SECTIONS} />);
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label, { exact: false }), { target: { value } });
}

beforeEach(() => {
  installStorage();
  // jsdom has no layout, so scrollTo is a stub the form calls on every error
  // and on success.
  window.scrollTo = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("QuestionnaireForm draft persistence", () => {
  it("LC-021: restores a saved draft after a refresh", () => {
    vi.useFakeTimers();
    const first = renderForm("eco-mech");
    type("Your name", "Nimal Perera");
    act(() => { vi.advanceTimersByTime(DEBOUNCE); });
    expect(window.localStorage.getItem(KEY("eco-mech"))).toContain("Nimal Perera");

    // A refresh is an unmount and a fresh mount with the same props.
    first.unmount();
    renderForm("eco-mech");
    expect(screen.getByLabelText("Your name", { exact: false })).toHaveProperty("value", "Nimal Perera");
    expect(screen.getByRole("status").textContent).toContain("brought back");
  });

  it("LC-021: discarding the restored draft empties the form and the store", () => {
    vi.useFakeTimers();
    const first = renderForm("eco-mech");
    type("Your name", "Nimal Perera");
    act(() => { vi.advanceTimersByTime(DEBOUNCE); });
    first.unmount();

    renderForm("eco-mech");
    fireEvent.click(screen.getByRole("button", { name: "Start fresh" }));
    act(() => { vi.advanceTimersByTime(DEBOUNCE); });
    expect(screen.getByLabelText("Your name", { exact: false })).toHaveProperty("value", "");
    expect(window.localStorage.getItem(KEY("eco-mech"))).toBeNull();
  });

  it("LC-021: a successful submit clears the draft", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ copySent: false }) })),
    );
    renderForm("eco-mech");
    type("Your name", "Nimal Perera");
    type("Describe the project", "A parts catalogue and a quote request form.");
    act(() => { vi.advanceTimersByTime(DEBOUNCE); });
    expect(window.localStorage.getItem(KEY("eco-mech"))).not.toBeNull();

    await act(async () => {
      fireEvent.submit(screen.getByRole("button", { name: /submit/i }).closest("form")!);
    });
    // A pending debounced write must not resurrect what was just submitted.
    act(() => { vi.advanceTimersByTime(DEBOUNCE * 4); });
    expect(window.localStorage.getItem(KEY("eco-mech"))).toBeNull();
  });

  it("LC-021: one client's draft is never restored into another client's form", () => {
    // Both the wrong key and a mismatched slug inside the payload: neither
    // may leak an answer across clients.
    window.localStorage.setItem(
      KEY("other-co"),
      JSON.stringify({ slug: "other-co", at: "2026-08-26T10:00:00.000Z", answers: { contactName: "Someone Else" } }),
    );
    window.localStorage.setItem(
      KEY("eco-mech"),
      JSON.stringify({ slug: "other-co", at: "2026-08-26T10:00:00.000Z", answers: { contactName: "Someone Else" } }),
    );

    renderForm("eco-mech");
    expect(screen.getByLabelText("Your name", { exact: false })).toHaveProperty("value", "");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("LC-021: a throwing localStorage leaves the form fully usable", () => {
    vi.useFakeTimers();
    const boom = () => { throw new Error("private mode"); };
    installStorage({ getItem: boom, setItem: boom, removeItem: boom });

    expect(() => {
      renderForm("eco-mech");
      type("Your name", "Nimal Perera");
      act(() => { vi.advanceTimersByTime(DEBOUNCE); });
    }).not.toThrow();
    expect(screen.getByLabelText("Your name", { exact: false })).toHaveProperty("value", "Nimal Perera");
  });
});

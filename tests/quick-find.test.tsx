// @vitest-environment jsdom
// Finding your way around: the Search button in the top bar, and the tabs on a
// client page.
//
// The first block is the guard the comment in components/QuickFind.tsx
// promises: the list of screens there is written out by hand, so a section
// that gains a page must fail here until the page is added to it.
import fs from "node:fs";
import path from "node:path";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ClientTabs, { CLIENT_TABS, clientTabFrom } from "@/components/ClientTabs";
import { SECTIONS } from "@/components/ConsoleTopbar";
import QuickFind, { DESTINATIONS } from "@/components/QuickFind";
import { GITHUB_SECTIONS } from "@/components/github/GithubNav";
import { SALES_SECTIONS } from "@/components/sales/SalesNav";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

// Invented clients. This repository is public: no real names in a fixture.
const CLIENTS = [
  { slug: "tide-tees", company: "Tide Tees", docNoBase: "0061" },
  { slug: "publish-house", company: "Publish House", docNoBase: "0062" },
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Answers the two things the palette asks for: the client list and the
 *  search inside documents. */
function stubFetch(clients: unknown = CLIENTS) {
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/clients")) return json(clients);
    if (url.startsWith("/api/search")) return json({ results: [] });
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

const clientCalls = (mock: ReturnType<typeof stubFetch>) =>
  mock.mock.calls.filter(([input]) => String(input).startsWith("/api/clients")).length;

const labels = (dialog: HTMLElement) =>
  within(dialog).queryAllByRole("option").map((o) => o.querySelector("span > span")?.textContent ?? "");

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /^Search/ }));
  return screen.findByRole("dialog", { name: "Search the console" });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  push.mockClear();
});

describe("the list of screens Search knows", () => {
  const known = new Set(DESTINATIONS.map((d) => d.href));

  it("has every screen the three navigations offer", () => {
    const offered = [...SECTIONS, ...SALES_SECTIONS, ...GITHUB_SECTIONS].map((s) => s.href);
    expect(offered.filter((href) => !known.has(href))).toEqual([]);
  });

  it("has home, the new client form and settings, which no section bar links", () => {
    expect(["/", "/clients/new", "/settings"].filter((href) => !known.has(href))).toEqual([]);
  });

  it("points only at pages that exist", () => {
    const missing = DESTINATIONS.filter(
      (d) => !fs.existsSync(path.join(process.cwd(), "app", d.href, "page.tsx")),
    ).map((d) => d.href);
    expect(missing).toEqual([]);
  });

  it("names each screen once", () => {
    expect(known.size).toBe(DESTINATIONS.length);
    expect(new Set(DESTINATIONS.map((d) => d.label)).size).toBe(DESTINATIONS.length);
  });
});

describe("Search in the top bar", () => {
  it("does not ask for the client list until it is opened, and asks once", async () => {
    const fetchMock = stubFetch();
    const user = userEvent.setup();
    render(<QuickFind />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    const dialog = await open(user);
    await within(dialog).findByText("Tide Tees");
    expect(clientCalls(fetchMock)).toBe(1);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await within(await open(user)).findByText("Tide Tees");
    expect(clientCalls(fetchMock)).toBe(1);
  });

  it("opens with a slash, but not while one is being typed into a field", async () => {
    stubFetch();
    const user = userEvent.setup();
    render(
      <>
        <textarea aria-label="Notes" />
        <QuickFind />
      </>,
    );

    const notes = screen.getByRole("textbox", { name: "Notes" });
    await user.type(notes, "invoice 1/2");
    expect((notes as HTMLTextAreaElement).value).toBe("invoice 1/2");
    expect(screen.queryByRole("dialog")).toBeNull();

    notes.blur();
    await user.keyboard("/");
    const dialog = await screen.findByRole("dialog", { name: "Search the console" });
    // The slash that opened it is not typed into the search box.
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole("combobox")));
    expect((within(dialog).getByRole("combobox") as HTMLInputElement).value).toBe("");
  });

  it("opens on the main screens, with the clients under them", async () => {
    stubFetch();
    const user = userEvent.setup();
    render(<QuickFind />);
    const dialog = await open(user);
    await within(dialog).findByText("Tide Tees");

    const shown = labels(dialog);
    const top = DESTINATIONS.filter((d) => d.top).map((d) => d.label);
    expect(shown.slice(0, top.length)).toEqual(top);
    expect(shown.slice(top.length)).toEqual(["Tide Tees", "Publish House"]);
    expect(within(dialog).getByText("Go to")).toBeTruthy();
    expect(within(dialog).getByText("Clients", { selector: "div" })).toBeTruthy();
  });

  it("finds a screen by a word people use for it, and Enter goes there", async () => {
    stubFetch();
    const user = userEvent.setup();
    render(<QuickFind />);
    const dialog = await open(user);
    const input = within(dialog).getByRole("combobox");

    // No screen is called "invoice" or "posts".
    await user.type(input, "invoice");
    expect(labels(dialog)).toEqual(["Clients"]);

    await user.clear(input);
    await user.type(input, "posts");
    expect(labels(dialog)).toEqual(["Sales: social kit"]);

    await user.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/sales/kit");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("puts a client whose name matches before a screen that does", async () => {
    stubFetch();
    const user = userEvent.setup();
    render(<QuickFind />);
    const dialog = await open(user);
    await within(dialog).findByText("Publish House");

    await user.type(within(dialog).getByRole("combobox"), "publish");
    expect(labels(dialog)).toEqual(["Publish House", "Publish"]);

    await user.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/clients/publish-house");
  });

  it("still lists the screens when the client list cannot be read", async () => {
    stubFetch();
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "no" }, 500)));
    const user = userEvent.setup();
    render(<QuickFind />);
    const dialog = await open(user);
    expect(labels(dialog)).toEqual(DESTINATIONS.filter((d) => d.top).map((d) => d.label));
  });

  it("ignores rows of the client list that are not clients", async () => {
    stubFetch([{ slug: "tide-tees", company: "Tide Tees" }, { slug: 7 }, null, "x"]);
    const user = userEvent.setup();
    render(<QuickFind />);
    const dialog = await open(user);
    await within(dialog).findByText("Tide Tees");
    expect(labels(dialog).filter((l) => !DESTINATIONS.some((d) => d.label === l))).toEqual(["Tide Tees"]);
  });
});

describe("the client page's tabs", () => {
  it("reads the tab from the address and falls back to the overview", () => {
    expect(clientTabFrom(undefined)).toBe("overview");
    expect(clientTabFrom("billing")).toBe("billing");
    expect(clientTabFrom(["messages", "billing"])).toBe("messages");
    expect(clientTabFrom("Billing")).toBe("overview");
    expect(clientTabFrom("../settings")).toBe("overview");
    expect(clientTabFrom([])).toBe("overview");
  });

  it("links every tab, the overview at the client's own address", () => {
    render(<ClientTabs slug="tide-tees" current="overview" />);
    const links = within(screen.getByRole("navigation", { name: "Client sections" })).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(
      CLIENT_TABS.map((t) => (t.id === "overview" ? "/clients/tide-tees" : `/clients/tide-tees?tab=${t.id}`)),
    );
  });

  it("marks exactly the tab in view", () => {
    render(<ClientTabs slug="tide-tees" current="billing" />);
    const current = screen.getAllByRole("link").filter((l) => l.getAttribute("aria-current") === "page");
    expect(current.map((l) => l.textContent)).toEqual(["Billing"]);
  });

  it("shows what is waiting behind a tab, and nothing for zero", () => {
    render(<ClientTabs slug="tide-tees" current="overview" counts={{ overview: 2, messages: 0 }} />);
    expect(screen.getByRole("link", { name: "Overview2" }).querySelector(".subnav-count")?.textContent).toBe("2");
    expect(screen.getByRole("link", { name: "Messages" }).querySelector(".subnav-count")).toBeNull();
  });
});

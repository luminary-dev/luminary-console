// @vitest-environment jsdom
// Search: the dialog that finds any screen or client. Opened from the menu,
// with ⌘K, or with "/".
//
// The screens it lists are the menu itself (lib/menu.ts), so the first block
// guards the menu: every entry is a real page, and no two share a name or an
// address.
import fs from "node:fs";
import path from "node:path";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ClientTabs, { CLIENT_TABS, clientTabFrom } from "@/components/ClientTabs";
import { openSearch } from "@/components/CommandPalette";
import QuickFind, { DESTINATIONS } from "@/components/QuickFind";
import { ALL_SCREENS, MENU } from "@/lib/menu";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

// Invented clients. This repository is public: no real names in a fixture.
const CLIENTS = [
  { slug: "tide-tees", company: "Tide Tees", docNoBase: "0061" },
  { slug: "replies-first", company: "Replies First", docNoBase: "0062" },
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

describe("the screens Search knows", () => {
  it("are the menu's, every one", () => {
    const known = new Set(DESTINATIONS.map((d) => d.href));
    expect(ALL_SCREENS.filter((s) => !known.has(s.href))).toEqual([]);
    expect(MENU.flatMap((g) => g.items).filter((i) => !known.has(i.href))).toEqual([]);
  });

  it("point only at pages that exist", () => {
    const missing = DESTINATIONS.filter(
      (d) => !fs.existsSync(path.join(process.cwd(), "app", d.href, "page.tsx")),
    ).map((d) => d.href);
    expect(missing).toEqual([]);
  });

  it("each have one name and one address", () => {
    expect(new Set(DESTINATIONS.map((d) => d.href)).size).toBe(DESTINATIONS.length);
    expect(new Set(DESTINATIONS.map((d) => d.label)).size).toBe(DESTINATIONS.length);
  });
});

describe("Search", () => {
  it("does not ask for the client list until it is opened, and asks once", async () => {
    const fetchMock = stubFetch();
    const user = userEvent.setup();
    render(<QuickFind trigger />);
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

  it("opens when a button elsewhere on the page asks, which is how the menu opens it", async () => {
    stubFetch();
    render(<QuickFind />);
    // No button of its own without `trigger`: the menu has the button.
    expect(screen.queryByRole("button", { name: /^Search/ })).toBeNull();
    openSearch();
    expect(await screen.findByRole("dialog", { name: "Search the console" })).toBeTruthy();
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

  it("opens on the places most visits go, with the clients under them", async () => {
    stubFetch();
    const user = userEvent.setup();
    render(<QuickFind trigger />);
    const dialog = await open(user);
    await within(dialog).findByText("Tide Tees");

    const shown = labels(dialog);
    const top = DESTINATIONS.filter((d) => d.top).map((d) => d.label);
    expect(top).toEqual(["Today", "All clients", "Add a client", "Message shops", "Pull requests", "History"]);
    expect(shown.slice(0, top.length)).toEqual(top);
    expect(shown.slice(top.length)).toEqual(["Tide Tees", "Replies First"]);
    expect(within(dialog).getByText("Go to")).toBeTruthy();
  });

  it("finds a screen by what it used to be called, and Enter goes there", async () => {
    stubFetch();
    const user = userEvent.setup();
    render(<QuickFind trigger />);
    const dialog = await open(user);
    const input = within(dialog).getByRole("combobox");

    // Nothing is called "scripts" or "deployments" any more.
    await user.type(input, "scripts");
    expect(labels(dialog)).toEqual(["Ready replies"]);

    await user.clear(input);
    await user.type(input, "deployments");
    expect(labels(dialog)).toEqual(["Live versions"]);

    await user.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/github/deployments");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("finds a screen by a word for what is on it", async () => {
    stubFetch();
    const user = userEvent.setup();
    render(<QuickFind trigger />);
    const dialog = await open(user);
    const input = within(dialog).getByRole("combobox");

    await user.type(input, "spreadsheet");
    expect(labels(dialog)).toEqual(["Devices and export"]);

    await user.clear(input);
    await user.type(input, "passwords");
    expect(labels(dialog)).toEqual(["Security alerts"]);
  });

  it("puts a client whose name matches before a screen that does", async () => {
    stubFetch();
    const user = userEvent.setup();
    render(<QuickFind trigger />);
    const dialog = await open(user);
    await within(dialog).findByText("Replies First");

    await user.type(within(dialog).getByRole("combobox"), "replies");
    expect(labels(dialog)).toEqual(["Replies First", "Ready replies"]);

    await user.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/clients/replies-first");
  });

  it("still lists the screens when the client list cannot be read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "no" }, 500)));
    const user = userEvent.setup();
    render(<QuickFind trigger />);
    const dialog = await open(user);
    expect(labels(dialog)).toEqual(DESTINATIONS.filter((d) => d.top).map((d) => d.label));
  });

  it("ignores rows of the client list that are not clients", async () => {
    stubFetch([{ slug: "tide-tees", company: "Tide Tees" }, { slug: 7 }, null, "x"]);
    const user = userEvent.setup();
    render(<QuickFind trigger />);
    const dialog = await open(user);
    await within(dialog).findByText("Tide Tees");
    expect(labels(dialog).filter((l) => !DESTINATIONS.some((d) => d.label === l))).toEqual(["Tide Tees"]);
  });
});

describe("the client page's tabs", () => {
  it("reads the tab from the address and falls back to the summary", () => {
    expect(clientTabFrom(undefined)).toBe("overview");
    expect(clientTabFrom("billing")).toBe("billing");
    expect(clientTabFrom(["messages", "billing"])).toBe("messages");
    expect(clientTabFrom("Billing")).toBe("overview");
    expect(clientTabFrom("../settings")).toBe("overview");
    expect(clientTabFrom([])).toBe("overview");
  });

  it("keeps the addresses it had before the tabs were renamed", () => {
    // A link to ?tab=billing sent last week still has to open Money.
    expect(CLIENT_TABS.map((t) => t.id)).toEqual(["overview", "documents", "design", "billing", "messages", "details"]);
    expect(CLIENT_TABS.map((t) => t.label)).toEqual([
      "Summary", "Documents", "Design & website", "Money", "Client messages", "Settings",
    ]);
  });

  it("links every tab, the summary at the client's own address", () => {
    render(<ClientTabs slug="tide-tees" current="overview" />);
    const links = within(screen.getByRole("navigation", { name: "Client sections" })).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(
      CLIENT_TABS.map((t) => (t.id === "overview" ? "/clients/tide-tees" : `/clients/tide-tees?tab=${t.id}`)),
    );
  });

  it("marks exactly the tab in view", () => {
    render(<ClientTabs slug="tide-tees" current="billing" />);
    const current = screen.getAllByRole("link").filter((l) => l.getAttribute("aria-current") === "page");
    expect(current.map((l) => l.textContent)).toEqual(["Money"]);
  });

  it("shows what is waiting behind a tab, and nothing for zero", () => {
    render(<ClientTabs slug="tide-tees" current="overview" counts={{ overview: 2, messages: 0 }} />);
    expect(screen.getByRole("link", { name: "Summary2" }).querySelector(".subnav-count")?.textContent).toBe("2");
    expect(screen.getByRole("link", { name: "Client messages" }).querySelector(".subnav-count")).toBeNull();
  });
});

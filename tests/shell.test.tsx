// @vitest-environment jsdom
// The console's frame: one menu on every screen, the same page header
// everywhere, the phone's bottom bar, Help, and the small pieces that keep a
// screen quiet (More, How this works, the first-visit welcome).
import fs from "node:fs";
import path from "node:path";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FirstVisit from "@/components/FirstVisit";
import HelpContent, { WORDS } from "@/components/HelpContent";
import HowItWorks from "@/components/HowItWorks";
import MoreActions from "@/components/MoreActions";
import NextStepCard, { NextStepBar } from "@/components/NextStepCard";
import PageSkeleton from "@/components/PageSkeleton";
import { CLIENT_TABS } from "@/components/ClientTabs";
import ConsoleFrame from "@/components/shell/ConsoleFrame";
import ConsoleShell from "@/components/shell/ConsoleShell";
import HistorySwitch from "@/components/shell/HistorySwitch";
import NavList from "@/components/shell/NavList";
import {
  ALL_SCREENS, CODE_HISTORY, HELP, HISTORY, MENU, SETTINGS, TODAY, currentFor, isConsolePath, placeOf,
} from "@/lib/menu";

let pathname = "/";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  pathname = "/";
  // The account control reads matchMedia on mount; jsdom has none.
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: false, media: "", onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    }),
  );
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/activity/unread")) return json({ unread: 4 });
    if (url.startsWith("/api/clients")) return json([]);
    return json({});
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const items = MENU.flatMap((g) => g.items);

describe("the menu, as data", () => {
  it("names things by the job, not the tool", () => {
    expect(MENU.map((g) => g.label)).toEqual(["Clients", "Find customers", "Our website", "Code"]);
    const labels = [TODAY, ...items, HISTORY, HELP, SETTINGS].map((i) => i.label);
    for (const old of ["Engineering", "Sales", "Publish", "Send", "Scripts", "Social kit", "Activity", "CI", "Deployments", "Insights", "Dashboard"]) {
      expect(labels).not.toContain(old);
    }
  });

  it("still finds a screen by its old name", () => {
    const words = (href: string) => `${placeOf(href).item?.keywords ?? ""}`;
    expect(words("/sales")).toContain("sales");
    expect(words("/sales/scripts")).toContain("scripts");
    expect(words("/github")).toContain("engineering");
    expect(words("/github/ci")).toContain("ci");
    expect(words("/github/deployments")).toContain("deployments");
    expect(words("/publish")).toContain("publish");
    expect(words("/activity")).toContain("activity");
  });

  it("gives every screen one plain sentence, and no em dashes", () => {
    for (const s of ALL_SCREENS) {
      expect(s.what.length).toBeGreaterThan(25);
      expect(s.what.endsWith(".")).toBe(true);
      expect(`${s.label} ${s.what}`).not.toContain("—");
    }
    for (const g of MENU) expect(g.what.endsWith(".")).toBe(true);
  });

  it("has a page behind every address, and no address twice", () => {
    const hrefs = ALL_SCREENS.map((s) => s.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const href of hrefs) {
      expect(fs.existsSync(path.join(process.cwd(), "app", href, "page.tsx")), href).toBe(true);
    }
  });

  it("did not move an address when it renamed a screen", () => {
    // Bookmarks, emails and notifications point at these.
    for (const href of ["/", "/clients", "/clients/new", "/sales", "/sales/shops", "/sales/scripts", "/sales/kit",
      "/publish", "/github", "/github/ci", "/github/deployments", "/github/releases", "/github/security",
      "/github/repos", "/github/insights", "/github/activity", "/activity", "/settings"]) {
      expect(ALL_SCREENS.some((s) => s.href === href), href).toBe(true);
    }
  });

  it("knows which entry an address lights", () => {
    expect(currentFor("/")).toBe("/");
    expect(currentFor("/clients")).toBe("/clients");
    expect(currentFor("/clients/new")).toBe("/clients/new");
    expect(currentFor("/clients/tide-tees")).toBe("/clients");
    expect(currentFor("/sales/kit/")).toBe("/sales/kit");
    expect(currentFor("/publish/project")).toBe("/publish/project");
    expect(currentFor("/github/some-org/some-repo/21")).toBe("/github");
    expect(currentFor("/github/activity")).toBe("/activity");
    expect(currentFor("/login")).toBeUndefined();
  });

  it("draws the frame only around the console's own screens", () => {
    for (const p of ["/", "/clients", "/clients/tide-tees", "/sales/kit", "/publish/project", "/github/ci", "/activity", "/help", "/settings"]) {
      expect(isConsolePath(p), p).toBe(true);
    }
    // Sign-in, a client's own pages, a document preview, and anything new.
    for (const p of ["/login", "/c/tide-tees", "/c/tide-tees/quotation", "/preview/tide-tees/quotation", "/quotation", "/questionnaire", "/api/clients", "/something-new"]) {
      expect(isConsolePath(p), p).toBe(false);
    }
  });
});

describe("the menu, on screen", () => {
  it("lists Today, each group under its name, then History", () => {
    render(<NavList current="/" />);
    const nav = screen.getByRole("navigation", { name: "Menu" });
    const links = within(nav).getAllByRole("link", { hidden: true });
    expect(links.map((l) => l.textContent)).toEqual([TODAY.label, ...items.map((i) => i.label), HISTORY.label]);
    expect(links.map((l) => l.getAttribute("href"))).toEqual([TODAY.href, ...items.map((i) => i.href), HISTORY.href]);
    for (const g of MENU) expect(within(nav).getByText(g.label, { selector: ".side-heading" })).toBeTruthy();
  });

  it("marks exactly the screen in view", () => {
    render(<NavList current="/sales/scripts" />);
    const on = screen.getAllByRole("link", { hidden: true }).filter((l) => l.getAttribute("aria-current") === "page");
    expect(on.map((l) => l.textContent)).toEqual(["Ready replies"]);
  });

  it("keeps Code folded until you are in it", () => {
    const { unmount } = render(<NavList current="/clients" />);
    expect(document.querySelector("details.side-group")?.hasAttribute("open")).toBe(false);
    unmount();
    render(<NavList current="/github/ci" />);
    expect(document.querySelector("details.side-group")?.hasAttribute("open")).toBe(true);
  });

  it("shows the unread count on History and tells whoever follows a link", async () => {
    const onNavigate = vi.fn();
    render(<NavList current="/" historyCount={<span className="side-count">3</span>} onNavigate={onNavigate} />);
    const history = screen.getByRole("link", { name: /History/ });
    expect(history.querySelector(".side-count")?.textContent).toBe("3");
    await userEvent.setup().click(screen.getByRole("link", { name: "All clients" }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});

describe("the frame in the layout", () => {
  it("wraps a console screen in the menu, with Search, Help and Account at its foot", async () => {
    pathname = "/sales/shops";
    render(<ConsoleFrame enabled><main>the page</main></ConsoleFrame>);
    const menu = document.getElementById("console-menu");
    expect(menu).not.toBeNull();
    expect(screen.getByText("the page").closest(".shell")).not.toBeNull();
    expect(within(menu!).getByRole("link", { name: "Shop list" }).getAttribute("aria-current")).toBe("page");
    expect(within(menu!).getByRole("button", { name: /^Search/ })).toBeTruthy();
    expect(within(menu!).getByRole("link", { name: "Help" }).getAttribute("href")).toBe("/help");
    expect(within(menu!).getByRole("button", { name: /account/i })).toBeTruthy();
    // The count arrives after the page, from the session-gated endpoint.
    await waitFor(() => expect(within(menu!).getByRole("link", { name: /History/ }).textContent).toContain("4"));
  });

  it("leaves everything that is not the console untouched", () => {
    for (const p of ["/login", "/c/tide-tees/quotation", "/preview/tide-tees/quotation", "/quotation"]) {
      pathname = p;
      const { unmount } = render(<ConsoleFrame enabled><main>the page</main></ConsoleFrame>);
      expect(document.getElementById("console-menu"), p).toBeNull();
      expect(screen.getByText("the page")).toBeTruthy();
      unmount();
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("is never drawn on a client's own subdomain, whatever the address", () => {
    pathname = "/";
    render(<ConsoleFrame enabled={false}><main>the page</main></ConsoleFrame>);
    expect(document.getElementById("console-menu")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("gives a phone five buttons, and Menu opens the same menu as a dialog", async () => {
    pathname = "/clients/tide-tees";
    const user = userEvent.setup();
    render(<ConsoleFrame enabled><main>the page</main></ConsoleFrame>);
    const bar = screen.getByRole("navigation", { name: "Shortcuts" });
    expect([...bar.children].map((c) => c.textContent)).toEqual(["Today", "Clients", "Customers", "Search", "Menu"]);
    expect(within(bar).getByRole("link", { name: "Clients" }).getAttribute("aria-current")).toBe("page");

    const menu = document.getElementById("console-menu")!;
    expect(menu.getAttribute("role")).toBeNull();
    const button = within(bar).getByRole("button", { name: "Menu" });
    expect(button.getAttribute("aria-expanded")).toBe("false");

    await user.click(button);
    expect(menu.getAttribute("role")).toBe("dialog");
    expect(menu.getAttribute("aria-modal")).toBe("true");
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(document.body.style.overflow).toBe("hidden");

    // Following a link closes it; so does Escape.
    await user.click(within(menu).getByRole("link", { name: "Message shops" }));
    expect(menu.getAttribute("role")).toBeNull();
    expect(document.body.style.overflow).toBe("");

    await user.click(button);
    expect(menu.getAttribute("role")).toBe("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(menu.getAttribute("role")).toBeNull());
  });

  it("opens Search from the menu, closing the menu sheet first", async () => {
    pathname = "/";
    const user = userEvent.setup();
    render(<ConsoleFrame enabled><main>the page</main></ConsoleFrame>);
    const menu = document.getElementById("console-menu")!;
    await user.click(screen.getByRole("button", { name: "Menu" }));
    await user.click(within(menu).getByRole("button", { name: /^Search/ }));
    expect(await screen.findByRole("dialog", { name: "Search the console" })).toBeTruthy();
    expect(menu.getAttribute("role")).toBeNull();
  });
});

describe("a page's header", () => {
  it("takes its title, purpose and trail from the menu", () => {
    render(<ConsoleShell current="/sales/scripts">content</ConsoleShell>);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Ready replies");
    expect(screen.getByText(placeOf("/sales/scripts").item!.what)).toBeTruthy();
    const trail = screen.getByRole("navigation", { name: "You are here" });
    expect(trail.textContent).toBe("Find customers");
    expect(screen.getByRole("main").id).toBe("main-content");
  });

  it("has no trail for a screen that is not in a group", () => {
    render(<ConsoleShell current="/">content</ConsoleShell>);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Today");
    expect(screen.queryByRole("navigation", { name: "You are here" })).toBeNull();
  });

  it("lets a page that is not in the menu say where it is", () => {
    render(
      <ConsoleShell
        current="/clients"
        title="Tide Tees"
        purpose="Shop website"
        trail={[{ label: "Clients", href: "/clients" }, { label: "Tide Tees", href: "/clients/tide-tees" }, { label: "Money" }]}
        action={<button type="button">Do it</button>}
        how={<p>The long version.</p>}
      >
        content
      </ConsoleShell>,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Tide Tees");
    const trail = screen.getByRole("navigation", { name: "You are here" });
    expect(within(trail).getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual(["/clients", "/clients/tide-tees"]);
    expect(within(trail).getAllByRole("listitem").map((l) => l.textContent)).toEqual(["Clients", "Tide Tees", "Money"]);
    expect(screen.getByRole("button", { name: "Do it" })).toBeTruthy();
    expect(screen.getByText("How this works")).toBeTruthy();
  });

  it("can drop the purpose line, and announces a page that is still loading", () => {
    render(<ConsoleShell current="/clients" purpose={null} busy>content</ConsoleShell>);
    expect(document.querySelector(".purpose")).toBeNull();
    expect(screen.getByRole("main").getAttribute("aria-busy")).toBe("true");
  });

  it("the loading skeleton keeps the real title when it knows the section", () => {
    const { unmount } = render(<PageSkeleton current="/sales" />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Message shops");
    expect(screen.getByText("Loading…")).toBeTruthy();
    unmount();
    render(<PageSkeleton />);
    expect(screen.getByRole("main").getAttribute("aria-busy")).toBe("true");
  });

  it("History is one place with a switch between its two halves", () => {
    render(<HistorySwitch current="code" />);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
      ["Clients and customers", HISTORY.href],
      ["Code", CODE_HISTORY.href],
    ]);
    expect(links.filter((l) => l.getAttribute("aria-current") === "page").map((l) => l.textContent)).toEqual(["Code"]);
  });
});

describe("Help", () => {
  it("describes every screen in the menu, linked, in the menu's words", () => {
    render(<HelpContent />);
    for (const s of ALL_SCREENS.filter((x) => x.href !== HELP.href)) {
      const link = screen.getAllByRole("link", { name: s.label }).find((l) => l.getAttribute("href") === s.href);
      expect(link, s.label).toBeTruthy();
      expect(screen.getAllByText(s.what).length, s.label).toBeGreaterThan(0);
    }
  });

  it("explains a client's six tabs and the studio's words", () => {
    render(<HelpContent />);
    const client = screen.getByRole("heading", { name: "On a client's page" }).closest("section")!;
    expect(within(client).getAllByRole("term").map((t) => t.textContent)).toEqual(CLIENT_TABS.map((t) => t.label));
    const words = screen.getByRole("heading", { name: "What our words mean" }).closest("section")!;
    expect(within(words).getAllByRole("term").map((t) => t.textContent)).toEqual(WORDS.map((w) => w.word));
    for (const w of ["Quotation", "Change order", "Handover pack", "Pull request", "Build", "Live version"]) {
      expect(WORDS.some((x) => x.word === w), w).toBe(true);
    }
    for (const w of WORDS) expect(`${w.word} ${w.means}`).not.toContain("—");
  });
});

describe("keeping a screen quiet", () => {
  it("More hides a row's other actions until asked, without unmounting them", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(
      <div className="row-actions">
        <button type="button">Publish</button>
        <MoreActions>
          <button type="button" onClick={onDelete}>Delete</button>
        </MoreActions>
      </div>,
    );
    const more = screen.getByRole("button", { name: "More" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    const panel = document.getElementById(more.getAttribute("aria-controls")!)!;
    expect(panel.hidden).toBe(true);
    // Mounted the whole time, so a half-typed instruction or an open
    // confirmation inside it survives the panel closing.
    expect(panel.querySelector("button")?.textContent).toBe("Delete");

    await user.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(panel.hidden).toBe(false);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledTimes(1);

    await user.click(more);
    expect(panel.hidden).toBe(true);
  });

  it("How this works keeps the long explanation one click away", () => {
    render(<HowItWorks><p>Read from the store.</p></HowItWorks>);
    const details = document.querySelector("details.how")!;
    expect(details.hasAttribute("open")).toBe(false);
    expect(details.querySelector("summary")?.textContent).toBe("How this works");
    expect(details.textContent).toContain("Read from the store.");
  });

  it("the welcome shows once, and Got it is remembered", async () => {
    const user = userEvent.setup();
    const first = render(<FirstVisit />);
    const card = await screen.findByRole("heading", { name: /New here/ });
    for (const g of MENU) expect(within(card.closest("section")!).getByText(g.label)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("heading", { name: /New here/ })).toBeNull();
    first.unmount();

    render(<FirstVisit />);
    await act(async () => {});
    expect(screen.queryByRole("heading", { name: /New here/ })).toBeNull();
  });

  it("the welcome stays quiet when the browser will not remember it", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<FirstVisit />);
    await act(async () => {});
    expect(screen.queryByRole("heading", { name: /New here/ })).toBeNull();
    getItem.mockRestore();
  });
});

describe("the top of a client's page", () => {
  const step = { stage: "accepted" as const, waitingOn: "client" as const, title: "Waiting for the client to pick a design.", detail: "They choose on their own page.", tab: "design" as const };

  it("shows the stages in order with the current one marked, whose turn it is, and the next step", () => {
    render(<NextStepCard slug="tide-tees" step={step} currentTab="overview" />);
    const path = screen.getByRole("list", { name: "The stages of a project" });
    expect(within(path).getAllByRole("listitem").map((l) => l.textContent)).toEqual([
      "Lead (done)", "Quoted (done)", "Accepted", "Development", "Delivered", "Warranty", "Closed",
    ]);
    expect(within(path).getAllByRole("listitem").filter((l) => l.getAttribute("aria-current") === "step").map((l) => l.textContent)).toEqual(["Accepted"]);
    expect(screen.getByText("Waiting on the client")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe(step.title);
    const go = screen.getByRole("link", { name: "Open Design & website" });
    expect(go.getAttribute("href")).toBe("/clients/tide-tees?tab=design");
  });

  it("does not offer a button to the tab you are already on", () => {
    render(<NextStepCard slug="tide-tees" step={step} currentTab="design" />);
    expect(screen.queryByRole("link", { name: /^Open / })).toBeNull();
  });

  it("is one line on the other tabs: which step, whose turn, what next", () => {
    render(<NextStepBar slug="tide-tees" step={step} currentTab="billing" />);
    const bar = screen.getByRole("region", { name: "Where this project is" });
    expect(within(bar).getByRole("link", { name: "Step 3 of 7: Accepted" }).getAttribute("href")).toBe("/clients/tide-tees");
    expect(bar.textContent).toContain("Waiting on the client: " + step.title);
    expect(within(bar).getByRole("link", { name: "Open Design & website" }).getAttribute("href")).toBe("/clients/tide-tees?tab=design");
    expect(within(bar).queryByRole("list")).toBeNull();
  });

  it("leaves the button out of the line on the tab where the step is done", () => {
    render(<NextStepBar slug="tide-tees" step={step} currentTab="design" />);
    expect(screen.queryByRole("link", { name: /^Open / })).toBeNull();
  });
});

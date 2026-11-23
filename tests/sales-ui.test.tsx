// @vitest-environment jsdom
// The sales section in the browser: the queue card, a tap that a teammate got
// to first, the shop list's filters, the import control and the kit's ticks.
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ImportShops from "@/components/sales/ImportShops";
import KitBoard from "@/components/sales/KitBoard";
import SalesNav, { SALES_SECTIONS } from "@/components/sales/SalesNav";
import SalesQueue from "@/components/sales/SalesQueue";
import ShopList from "@/components/sales/ShopList";
import type { Kit } from "@/lib/kit";
import type { Lead, ProgressMap } from "@/lib/sales";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const ME = "dhanikaanupama2000@gmail.com";
const GAVEEN = "buddhikagaveen2021@gmail.com";
const NOW = new Date("2026-11-24T06:00:00Z").getTime();

function lead(over: Partial<Lead> & { id: string; name: string }): Lead {
  return {
    nicheLabel: "Home baker", group: "bakers", city: "Colombo", ig: "shop_ig", wa: "", waOk: false, phone: "",
    sells: "Cakes", hook: "Your highlights are a ready-made menu.", check: "No site found.", evidence: "", source: "",
    conf: "high", followers: 1500, posts: 90, hold: false, why: "", checked: "21 Nov", ...over,
  };
}
const BAKES = lead({ id: "bakes", name: "Sample Bakes", wa: "94770000002", waOk: true });
const ART = lead({ id: "art", name: "Paper Lantern", nicheLabel: "Handmade gifts", city: "" });
const HELD = lead({ id: "held", name: "Quiet Oven", hold: true, why: "No recent posts were seen." });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  refresh.mockClear();
});

describe("SalesNav", () => {
  it("marks exactly the current page", () => {
    render(<SalesNav current="/sales/shops" />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(SALES_SECTIONS.length);
    expect(links.filter((l) => l.getAttribute("aria-current") === "page").map((l) => l.textContent)).toEqual(["Shops"]);
  });
});

describe("SalesQueue", () => {
  it("shows the next shop with its message and a WhatsApp link that carries it", () => {
    render(<SalesQueue leads={[ART, BAKES]} initialProgress={{}} operator={ME} me="Dhanika" now={NOW} />);
    // WhatsApp shops come before Instagram ones.
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Sample Bakes");
    expect(screen.getByText(/Hi! I'm Dhanika from Luminary \(instagram\.com\/luminary\.xyz\)/)).toBeTruthy();
    const open = screen.getByRole("link", { name: "Open WhatsApp with this message" });
    expect(open.getAttribute("href")).toMatch(/^https:\/\/wa\.me\/94770000002\?text=Hi!%20I'm%20Dhanika/);
    expect(screen.getByText(/Today: 0 of 15 first messages sent by you/)).toBeTruthy();
  });

  it("records a send and moves to the next shop", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ id: "bakes", action: { type: "sent", step: 0 } });
      return json({ ok: true, id: "bakes", progress: { status: "sent", sentAt: new Date(NOW).toISOString(), sentBy: ME, followUps: 0, updatedAt: "", updatedBy: ME } });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<SalesQueue leads={[BAKES, ART]} initialProgress={{}} operator={ME} me="Dhanika" now={NOW} />);
    await user.click(screen.getByRole("button", { name: "I sent it" }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Paper Lantern"));
    expect(screen.getByText(/Today: 1 of 15 first messages sent by you/)).toBeTruthy();
    // An Instagram shop: copy first, then open the chat as our profile.
    expect(screen.getByRole("button", { name: "1. Copy the message" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open their Instagram chat as @luminary\.xyz/ }).getAttribute("href")).toBe("https://ig.me/m/shop_ig");
  });

  it("says who got there first when a teammate already messaged the shop, and re-reads the board", async () => {
    const user = userEvent.setup();
    const theirs: ProgressMap = { bakes: { status: "sent", sentAt: new Date(NOW).toISOString(), sentBy: GAVEEN, followUps: 0, updatedAt: "", updatedBy: GAVEEN } };
    const fetchMock = vi.fn(async (url: string) =>
      url === "/api/sales/progress"
        ? json({ error: "Gaveen already messaged this shop on 2026-11-24." }, 409)
        : json({ leads: [], importedAt: null, importedBy: null, progress: theirs }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<SalesQueue leads={[BAKES, ART]} initialProgress={{}} operator={ME} me="Dhanika" now={NOW} />);
    await user.click(screen.getByRole("button", { name: "I sent it" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Gaveen already messaged this shop on 2026-11-24.");
    // The refresh brings Gaveen's record in, so the queue moves past that shop.
    await waitFor(() => expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Paper Lantern"));
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["/api/sales/progress", "/api/sales"]);
  });

  it("puts a due follow-up first and offers 'they already replied'", () => {
    const sent: ProgressMap = { art: { status: "sent", sentAt: "2026-11-21T06:00:00Z", sentBy: GAVEEN, followUps: 0, updatedAt: "", updatedBy: GAVEEN } };
    render(<SalesQueue leads={[BAKES, ART]} initialProgress={sent} operator={ME} me="Dhanika" now={NOW} />);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Paper Lantern");
    expect(screen.getByText("Follow-up, sent 3 days ago")).toBeTruthy();
    expect(screen.getByRole("button", { name: "They already replied" })).toBeTruthy();
    expect(screen.getByText(/1 follow-up due/)).toBeTruthy();
  });

  it("skips a shop for this visit only, and says so when the queue runs out", async () => {
    const user = userEvent.setup();
    render(<SalesQueue leads={[BAKES]} initialProgress={{}} operator={ME} me="Dhanika" now={NOW} />);
    await user.click(screen.getByRole("button", { name: "Skip for today" }));
    expect(screen.getByText(/You skipped the rest for today/)).toBeTruthy();
  });

  it("asks for a first name when the session does not give one, and holds the send until it has it", async () => {
    const user = userEvent.setup();
    render(<SalesQueue leads={[BAKES]} initialProgress={{}} operator="operator" me="" now={NOW} />);
    expect((screen.getByRole("button", { name: "I sent it" }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText("Your first name, as the shop will read it"), "Dhanika");
    expect((screen.getByRole("button", { name: "I sent it" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/Hi! I'm Dhanika from Luminary/)).toBeTruthy();
  });

  it("switches the first message to Sinhala", async () => {
    const user = userEvent.setup();
    render(<SalesQueue leads={[BAKES]} initialProgress={{}} operator={ME} me="Dhanika" now={NOW} />);
    await user.click(screen.getByRole("button", { name: "Sinhala" }));
    expect(screen.getByText(/එකේ Dhanika/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sinhala" }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("ShopList", () => {
  const progress: ProgressMap = {
    bakes: { status: "sent", sentAt: "2026-11-23T06:00:00Z", sentBy: GAVEEN, followUps: 0, updatedAt: "2026-11-23T06:00:00Z", updatedBy: GAVEEN },
  };

  it("filters by where a shop stands, and keeps held shops apart with the reason", async () => {
    const user = userEvent.setup();
    render(<ShopList leads={[BAKES, ART, HELD]} initialProgress={progress} me="Dhanika" now={NOW} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText(/Gaveen messaged/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /^Messaged 1$/ }));
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.querySelector(".sales-shop-name")?.textContent).toBe("Sample BakesHome baker · Colombo");

    await user.click(screen.getByRole("button", { name: /^Held back 1$/ }));
    expect(screen.getByText("No recent posts were seen.")).toBeTruthy();
  });

  it("changes a shop's status through the shared record", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ id: "art", action: { type: "status", status: "replied" } });
      return json({ ok: true, id: "art", progress: { status: "replied", followUps: 0, updatedAt: new Date(NOW).toISOString(), updatedBy: ME } });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShopList leads={[ART]} initialProgress={{}} me="Dhanika" now={NOW} />);
    await user.selectOptions(screen.getByLabelText("Status"), "replied");
    await waitFor(() => expect(screen.getByRole("button", { name: /^In conversation 1$/ })).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("saves a note and a preview link only once something changed", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.action).toEqual({ type: "details", note: "call after 5", previewUrl: "" });
      return json({ ok: true, id: "art", progress: { status: "new", followUps: 0, note: "call after 5", updatedAt: new Date(NOW).toISOString(), updatedBy: ME } });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ShopList leads={[ART]} initialProgress={{}} me="Dhanika" now={NOW} />);
    const save = screen.getByRole("button", { name: "Save note and link" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await user.type(screen.getByLabelText("Note for the team"), "call after 5");
    expect(save.disabled).toBe(false);
    await user.click(save);
    await waitFor(() => expect((screen.getByLabelText("Note for the team") as HTMLTextAreaElement).value).toBe("call after 5"));
  });
});

describe("ImportShops", () => {
  const upload = async (response: Response) => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => response));
    render(<ImportShops count={0} />);
    const file = new File(['[{"id":"a","name":"A"}]'], "leads-checked.json", { type: "application/json" });
    await user.upload(screen.getByLabelText("Import the shop list"), file);
  };

  it("reports what was imported and refreshes the page", async () => {
    await upload(json({ ok: true, total: 68, added: 23, removed: 0 }));
    expect((await screen.findByRole("status")).textContent).toContain("Imported 68 shops: 23 new.");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("lists the problems when the file is refused", async () => {
    await upload(json({ error: "The list was not imported.", problems: ["Shop 2: wa: wa must be digits only, international form"] }, 400));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The list was not imported.");
    expect(within(alert).getByRole("listitem").textContent).toContain("Shop 2: wa");
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("KitBoard", () => {
  const KIT: Kit = {
    generatedAt: "2026-11-24T00:00:00.000Z",
    profile: { name: "Luminary", handle: "luminary.xyz", url: "https://www.instagram.com/luminary.xyz/", category: "Web Designer", bio: "Websites for Instagram shops" },
    facebook: { name: "Luminary", category: "Web Designer", bio: "Websites", about: "About" },
    posts: [
      { id: "b1", label: "B1", title: "Hello", day: 1, files: ["buildup/b1-hello.jpg"], caption: "Hello, Instagram.", alt: "Two designers waving." },
      { id: "4", label: "04", title: "How it works", day: 5, files: ["posts/04-1.jpg", "posts/04-2.jpg"], caption: "Four steps.", alt: "Your shop, live in 3 days." },
    ],
    highlights: [],
    extras: [{ label: "Profile picture", file: "profile-picture.jpg" }],
  };

  it("lists posts with pictures served through the console and same-origin downloads", () => {
    render(<KitBoard kit={KIT} initialPosted={{}} kitUrl="https://kit.example.test/" />);
    const img = screen.getByAltText("Two designers waving.") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("/api/sales/kit/file?path=buildup%2Fb1-hello.jpg");
    expect(screen.getByRole("link", { name: "Download picture" }).getAttribute("href")).toBe("/api/sales/kit/file?path=buildup%2Fb1-hello.jpg&dl=1");
    expect(screen.getByRole("link", { name: "Picture 2" }).getAttribute("download")).toBe("04-2.jpg");
    expect(screen.getByText("0 of 2 on Instagram · 0 on Facebook")).toBeTruthy();
    expect(screen.getByRole("link", { name: "B1, Hello" }).getAttribute("href")).toBe("#post-b1");
  });

  it("ticks a post for the team and drops it from 'to post' once it is up on both", async () => {
    const user = userEvent.setup();
    const posted = { b1: { facebook: { at: "2026-11-23T06:00:00Z", by: GAVEEN } } };
    vi.stubGlobal("fetch", vi.fn(async () =>
      json({ ok: true, id: "b1", marks: { ...posted.b1, instagram: { at: new Date(NOW).toISOString(), by: ME } } }),
    ));
    render(<KitBoard kit={KIT} initialPosted={posted} kitUrl="https://kit.example.test/" />);
    const first = screen.getAllByRole("listitem")[0];
    expect(first && within(first).getByText(/Gaveen/)).toBeTruthy();
    await user.click(within(first as HTMLElement).getByRole("checkbox", { name: /On Instagram/ }));
    await waitFor(() => expect(screen.getByText("1 of 2 on Instagram · 1 on Facebook")).toBeTruthy());
    expect(screen.queryByAltText("Two designers waving.")).toBeNull();
    await user.click(screen.getByRole("button", { name: "All 2" }));
    expect(screen.getByAltText("Two designers waving.")).toBeTruthy();
  });

  it("puts the tick back and says why when it does not save", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "The kit site could not be reached." }, 502)));
    render(<KitBoard kit={KIT} initialPosted={{}} kitUrl="https://kit.example.test/" />);
    const box = screen.getAllByRole("checkbox", { name: /On Instagram/ })[0] as HTMLInputElement;
    await user.click(box);
    expect((await screen.findByRole("alert")).textContent).toBe("The kit site could not be reached.");
    expect(box.checked).toBe(false);
  });
});

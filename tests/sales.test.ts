// The sales board's rules (lib/sales.ts): who is next, what the message says,
// and what a tap does to a shop's shared record. All pure, so no store here.
import { describe, expect, it } from "vitest";
import {
  DAILY_CAP,
  OFFER,
  SCRIPTS,
  SalesReject,
  applyAction,
  buildQueue,
  channelOf,
  colomboDay,
  daysSince,
  firstsToday,
  messageFor,
  nextStep,
  parseAction,
  parseLeads,
  scriptText,
  sendLink,
  statusOf,
  tally,
  type Lead,
  type Progress,
  type ProgressMap,
} from "@/lib/sales";
import { atIndex } from "./helpers";

const ME = "dhanikaanupama2000@gmail.com";
const THEM = "buddhikagaveen2021@gmail.com";
const at = (iso: string) => new Date(iso).getTime();

function lead(over: Partial<Lead> & { id: string }): Lead {
  return {
    name: over.id,
    nicheLabel: "Home baker",
    group: "bakers",
    city: "Colombo",
    ig: "shop_ig",
    wa: "",
    waOk: false,
    phone: "",
    sells: "",
    hook: "Your highlights are a ready-made menu.",
    check: "",
    evidence: "",
    source: "",
    conf: "high",
    followers: 100,
    posts: 10,
    hold: false,
    why: "",
    checked: "21 Nov",
    ...over,
  };
}
const wa = (id: string) => lead({ id, wa: "94770000001", waOk: true });

describe("parseLeads", () => {
  const raw = { id: "sample-bakes", name: " Sample Bakes ", ig: "sample_bakes", wa: "94770000002", waOk: true, kind: "bakery", found: true };

  it("keeps the fields the board uses, trims them, and drops the rest", () => {
    const out = parseLeads([raw]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const l = atIndex(out.leads, 0);
    expect(l.name).toBe("Sample Bakes");
    expect(l.followers).toBeNull();
    expect(l.hold).toBe(false);
    expect("kind" in l).toBe(false);
  });

  it("refuses a file that is not a list, an empty list, and an oversized one", () => {
    expect(parseLeads({ leads: [] }).ok).toBe(false);
    expect(parseLeads([]).ok).toBe(false);
    expect(parseLeads(Array.from({ length: 501 }, (_, i) => ({ id: `s${i}`, name: "x" }))).ok).toBe(false);
  });

  it("names the shop and the field when an entry is wrong", () => {
    const out = parseLeads([raw, { ...raw, id: "second", wa: "+94 77 123" }]);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(atIndex(out.errors, 0)).toMatch(/^Shop 2: wa/);
  });

  it("treats a repeated id as a problem instead of merging silently", () => {
    const out = parseLeads([raw, raw]);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(atIndex(out.errors, 0)).toContain('"sample-bakes" is used twice');
  });
});

describe("channelOf", () => {
  it("uses WhatsApp only when the number is printed on the shop's own page", () => {
    expect(channelOf({ wa: "94770000001", waOk: true, ig: "x" })).toBe("whatsapp");
    expect(channelOf({ wa: "94770000001", waOk: false, ig: "x" })).toBe("instagram");
    expect(channelOf({ wa: "", waOk: false, ig: "" })).toBe("none");
  });
});

describe("days are counted in Colombo, not UTC", () => {
  it("rolls the day over at midnight Sri Lanka time (18:30 UTC)", () => {
    expect(colomboDay("2026-11-24T18:29:59Z")).toBe(colomboDay("2026-11-24T00:00:00Z"));
    expect(colomboDay("2026-11-24T18:30:00Z")).toBe(colomboDay("2026-11-24T00:00:00Z") + 1);
  });

  it("a message sent late at night is one day old the next morning", () => {
    // 23:10 on the 22nd in Colombo, read at 07:00 on the 23rd in Colombo.
    expect(daysSince("2026-11-22T17:40:00Z", at("2026-11-23T01:30:00Z"))).toBe(1);
  });
});

describe("nextStep", () => {
  const sent = (followUps: number): Progress => ({
    status: "sent", sentAt: "2026-11-20T06:00:00Z", sentBy: ME, followUps, updatedAt: "", updatedBy: ME,
  });

  it("a shop nobody has touched is due its first message", () => {
    expect(nextStep({ hold: false }, undefined, at("2026-11-24T06:00:00Z"))).toBe(0);
  });

  it("a held shop is never due anything", () => {
    expect(nextStep({ hold: true }, undefined, at("2026-11-24T06:00:00Z"))).toBeNull();
  });

  it("follow-ups come two and five days after the first message", () => {
    expect(nextStep({ hold: false }, sent(0), at("2026-11-21T06:00:00Z"))).toBeNull();
    expect(nextStep({ hold: false }, sent(0), at("2026-11-22T06:00:00Z"))).toBe(1);
    expect(nextStep({ hold: false }, sent(1), at("2026-11-24T06:00:00Z"))).toBeNull();
    expect(nextStep({ hold: false }, sent(1), at("2026-11-25T06:00:00Z"))).toBe(2);
    expect(nextStep({ hold: false }, sent(2), at("2026-12-25T06:00:00Z"))).toBeNull();
  });

  it("a shop in conversation or closed drops out of the queue", () => {
    for (const status of ["replied", "keen", "won", "no"] as const) {
      expect(nextStep({ hold: false }, { ...sent(0), status }, at("2026-11-30T06:00:00Z"))).toBeNull();
    }
  });
});

describe("buildQueue", () => {
  const now = at("2026-11-24T06:00:00Z");
  const leads = [lead({ id: "dm-one" }), wa("wa-one"), lead({ id: "held", hold: true }), wa("wa-due"), lead({ id: "nowhere", ig: "" })];
  const progress: ProgressMap = {
    "wa-due": { status: "sent", sentAt: "2026-11-21T06:00:00Z", sentBy: THEM, followUps: 0, updatedAt: "", updatedBy: THEM },
  };

  it("puts due follow-ups first, then new shops with WhatsApp before Instagram", () => {
    const q = buildQueue(leads, progress, now, ME);
    expect(q.items.map((i) => [i.lead.id, i.step])).toEqual([["wa-due", 1], ["wa-one", 0], ["dm-one", 0]]);
    expect(q.due).toBe(1);
    expect(q.fresh).toBe(2);
    expect(atIndex(q.items, 0).days).toBe(3);
  });

  it("leaves out held shops, shops with no way to reach them, and skipped ones", () => {
    const q = buildQueue(leads, progress, now, ME, new Set(["wa-one"]));
    expect(q.items.map((i) => i.lead.id)).toEqual(["wa-due", "dm-one"]);
  });

  it("stops offering new shops at the daily cap, per operator, but keeps follow-ups", () => {
    const mine: ProgressMap = { ...progress };
    for (let i = 0; i < DAILY_CAP; i++) {
      mine[`done-${i}`] = { status: "sent", sentAt: "2026-11-24T04:00:00Z", sentBy: ME, followUps: 0, updatedAt: "", updatedBy: ME };
    }
    expect(firstsToday(mine, ME, now)).toBe(DAILY_CAP);
    const capped = buildQueue(leads, mine, now, ME);
    expect(capped.room).toBe(0);
    expect(capped.items.map((i) => i.lead.id)).toEqual(["wa-due"]);
    // A teammate's cap is their own.
    expect(buildQueue(leads, mine, now, THEM).room).toBe(DAILY_CAP);
  });

  it("does not count yesterday's messages against today", () => {
    const old: ProgressMap = { x: { status: "sent", sentAt: "2026-11-23T04:00:00Z", sentBy: ME, followUps: 0, updatedAt: "", updatedBy: ME } };
    expect(firstsToday(old, ME, now)).toBe(0);
  });
});

describe("tally", () => {
  it("counts ready shops by status and held shops apart", () => {
    const leads = [wa("a"), wa("b"), wa("c"), lead({ id: "h", hold: true })];
    const progress: ProgressMap = {
      a: { status: "sent", followUps: 0, updatedAt: "", updatedBy: ME },
      b: { status: "won", followUps: 0, updatedAt: "", updatedBy: ME },
    };
    expect(tally(leads, progress)).toMatchObject({ ready: 3, held: 1, new: 1, sent: 1, won: 1, replied: 0 });
    expect(statusOf(progress, "c")).toBe("new");
  });
});

describe("applyAction", () => {
  const now = at("2026-11-24T06:00:00Z");

  it("records a first message with who sent it and when", () => {
    const p = applyAction(undefined, { type: "sent", step: 0 }, now, ME);
    expect(p).toMatchObject({ status: "sent", sentBy: ME, sentAt: "2026-11-24T06:00:00.000Z", followUps: 0, updatedBy: ME });
  });

  it("refuses a second first message and names the teammate who sent the first", () => {
    const first = applyAction(undefined, { type: "sent", step: 0 }, now, THEM);
    const names = (email: string) => (email === THEM ? "Gaveen" : email);
    let caught: unknown;
    try {
      applyAction(first, { type: "sent", step: 0 }, now + 60_000, ME, names);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SalesReject);
    expect((caught as SalesReject).status).toBe(409);
    expect((caught as SalesReject).message).toBe("Gaveen already messaged this shop on 2026-11-24.");
  });

  it("records follow-ups in order and refuses one that is already recorded", () => {
    const first = applyAction(undefined, { type: "sent", step: 0 }, now, ME);
    const one = applyAction(first, { type: "sent", step: 1 }, now + 2 * 86_400_000, THEM);
    expect(one).toMatchObject({ followUps: 1, sentBy: ME, updatedBy: THEM });
    expect(() => applyAction(one, { type: "sent", step: 1 }, now, ME)).toThrow(SalesReject);
    expect(applyAction(one, { type: "sent", step: 2 }, now + 5 * 86_400_000, ME).followUps).toBe(2);
  });

  it("refuses a follow-up for a shop that has replied or was never messaged", () => {
    expect(() => applyAction(undefined, { type: "sent", step: 1 }, now, ME)).toThrow(/no follow-up to record/);
    const replied: Progress = { status: "replied", followUps: 0, updatedAt: "", updatedBy: ME };
    expect(() => applyAction(replied, { type: "sent", step: 1 }, now, ME)).toThrow(SalesReject);
    expect(() => applyAction(replied, { type: "sent", step: 0 }, now, ME)).toThrow(/already marked replied/);
  });

  it("setting a shop back to not contacted forgets the send, and keeps the note", () => {
    const sent = applyAction(undefined, { type: "sent", step: 0 }, now, ME);
    const noted = applyAction(sent, { type: "details", note: " asked for a call " }, now, ME);
    const reset = applyAction(noted, { type: "status", status: "new" }, now, ME);
    expect(reset.status).toBe("new");
    expect(reset.sentAt).toBeUndefined();
    expect(reset.sentBy).toBeUndefined();
    expect(reset.note).toBe("asked for a call");
  });

  it("marking a shop messaged by hand stamps the day, so follow-ups can be counted", () => {
    const p = applyAction(undefined, { type: "status", status: "sent" }, now, ME);
    expect(p).toMatchObject({ status: "sent", sentBy: ME, sentAt: "2026-11-24T06:00:00.000Z" });
    // Moving an already-messaged shop on does not restamp it.
    const later = applyAction(p, { type: "status", status: "replied" }, now + 86_400_000, THEM);
    expect(later).toMatchObject({ status: "replied", sentBy: ME, sentAt: "2026-11-24T06:00:00.000Z", updatedBy: THEM });
  });

  it("stores a note and an https preview link, and clears either with an empty value", () => {
    const p = applyAction(undefined, { type: "details", note: "x".repeat(700), previewUrl: " https://example.test/shop " }, now, ME);
    expect(p.note).toHaveLength(600);
    expect(p.previewUrl).toBe("https://example.test/shop");
    const cleared = applyAction(p, { type: "details", note: "", previewUrl: "" }, now, ME);
    expect(cleared.note).toBeUndefined();
    expect(cleared.previewUrl).toBeUndefined();
  });

  it("refuses a preview link that is not an https address", () => {
    expect(() => applyAction(undefined, { type: "details", previewUrl: "javascript:alert(1)" }, now, ME)).toThrow(/https/);
    expect(() => applyAction(undefined, { type: "details", previewUrl: "not a link" }, now, ME)).toThrow(/https/);
  });
});

describe("parseAction", () => {
  it("accepts the three kinds of tap and nothing else", () => {
    expect(parseAction({ type: "sent", step: 0 })).toEqual({ type: "sent", step: 0 });
    expect(parseAction({ type: "status", status: "won" })).toEqual({ type: "status", status: "won" });
    expect(parseAction({ type: "details", note: "hi" })).toEqual({ type: "details", note: "hi" });
    expect(parseAction({ type: "sent", step: 3 })).toBeNull();
    expect(parseAction({ type: "status", status: "paid" })).toBeNull();
    expect(parseAction({ type: "delete" })).toBeNull();
    expect(parseAction(null)).toBeNull();
  });
});

describe("messageFor", () => {
  it("a first message on WhatsApp names our Instagram by its full address", () => {
    const m = messageFor(wa("bakes"), 0, { me: "Dhanika" });
    expect(m).toContain(`Hi! I'm Dhanika from Luminary (instagram.com/${OFFER.instagram}), a small web studio`);
    expect(m).toContain("Your highlights are a ready-made menu.");
    expect(m).toContain(OFFER.sample);
    expect(m).toContain("Can I build a free preview for bakes");
  });

  it("an Instagram DM leaves the profile out, since it already comes from it", () => {
    const m = messageFor(lead({ id: "dm" }), 0, { me: "Dhanika" });
    expect(m).toContain("from Luminary, a small web studio");
    expect(m).not.toContain("instagram.com");
  });

  it("switches to the preview wording once a preview link exists", () => {
    const m = messageFor(wa("bakes"), 0, { me: "Dhanika", previewUrl: "https://example.test/bakes" });
    expect(m).toContain("So I built a preview");
    expect(m).toContain("https://example.test/bakes");
    expect(m).toContain("in 3 days for LKR 17,500");
  });

  it("writes the Sinhala first message when asked", () => {
    expect(messageFor(wa("bakes"), 0, { me: "Dhanika", lang: "si" })).toContain("එකේ Dhanika");
  });

  it("follow-ups are short and mention the preview only when there is one", () => {
    expect(messageFor(wa("bakes"), 1, { me: "Dhanika" })).toContain("Shall I go ahead and build the free preview?");
    expect(messageFor(wa("bakes"), 1, { me: "Dhanika", previewUrl: "https://example.test/c" })).toContain("https://example.test/c");
    expect(messageFor(wa("bakes"), 2, { me: "Dhanika" })).toMatch(/^Last message from me\./);
  });

  it("leaves no unfilled placeholder in any message", () => {
    for (const step of [0, 1, 2] as const) {
      for (const previewUrl of [undefined, "https://example.test/p"]) {
        expect(messageFor(wa("bakes"), step, { me: "Dhanika", previewUrl })).not.toMatch(/\{\w+\}/);
      }
    }
  });
});

describe("sendLink", () => {
  it("opens WhatsApp with the message typed, or the shop's Instagram chat", () => {
    expect(sendLink(wa("a"), "Hi there & hello")).toBe("https://wa.me/94770000001?text=Hi%20there%20%26%20hello");
    expect(sendLink(lead({ id: "b", ig: "shop.ig" }), "Hi")).toBe("https://ig.me/m/shop.ig");
    expect(sendLink(lead({ id: "c", ig: "" }), "Hi")).toBeNull();
  });
});

describe("scripts", () => {
  it("fill in the offer's numbers and leave no placeholder behind", () => {
    for (const s of SCRIPTS) expect(scriptText(s)).not.toMatch(/\{\w+\}/);
    const price = SCRIPTS.find((s) => s.id === "price");
    expect(price && scriptText(price)).toContain("It is LKR 17,500, paid once: LKR 8,750 to start");
  });
});

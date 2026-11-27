// The sales board's rules, as pure functions: who is next, what the message
// says, what a tap on "I sent it" does to a shop's record. No I/O in here, so
// every rule is unit-tested without a store (tests/sales.test.ts) and the
// server and the browser compute the same answer from the same data.
//
// The board is a list of researched shops (the "leads"), imported from
// Products/shopfront/sales/leads-checked.json, plus one progress record per
// shop that all three operators share. The shared record is the point of
// having this in the console: the stand-alone board kept progress in each
// browser, so two people could message the same shop without knowing.
import { z } from "zod";

// ——— the offer the messages quote ———

/** Shopfront's public offer. Mirrors Products/shopfront/shopfront.config.json;
 *  change both together. */
const PRICE = 17_500;
export const OFFER = {
  price: PRICE,
  /** Paid half to start and half when the shop is live. */
  half: Math.round(PRICE / 2),
  regularPrice: 25_000,
  days: 3,
  deadline: "31 December 2026",
  items: 30,
  /** After the first free month: updates by the month, or per update. */
  care: 1_500,
  perUpdate: 750,
  /** Hosting from the second year (the first year is included). */
  hostingYearly: 3_500,
  /** About what a .lk address costs a year, paid to the registry in the shop's name. */
  lkAddress: 6_000,
  /** Order by this date and the shop is live before the Christmas orders. */
  christmasBy: "15 December",
  /** Paid to whoever introduces a shop, once that shop is live and paid in full. */
  referral: 2_500,
  /** A finished shop shown as proof in first messages. */
  sample: "https://dev.luvana.lk",
  offerUrl: "https://shopfront.luminary-dev.xyz/",
  /** The studio's Instagram username. It reads like a web address that is not
   *  ours, so messages always give the full instagram.com link instead. */
  instagram: "luminary.xyz",
} as const;

export const lkr = (n: number) => `LKR ${n.toLocaleString("en-US")}`;

// ——— shops ———

const text = (max: number) =>
  z
    .string()
    .nullish()
    .transform((v) => (v ?? "").trim().slice(0, max));
const count = z
  .number()
  .nullish()
  .transform((v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null));

/** One researched shop. Unknown keys in the import file are dropped. */
export const LeadSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "id must be lowercase letters, digits and dashes"),
  name: z.string().trim().min(1).max(120),
  nicheLabel: text(80),
  group: text(40),
  city: text(80),
  /** Instagram username, no @. */
  ig: text(40).refine((v) => v === "" || /^[A-Za-z0-9._]+$/.test(v), "not an Instagram username"),
  /** WhatsApp number, digits only in international form, or "". */
  wa: text(20).refine((v) => v === "" || /^\d{9,15}$/.test(v), "wa must be digits only, international form"),
  /** True when that number is printed on the shop's own page. */
  waOk: z.boolean().nullish().transform((v) => v === true),
  phone: text(240),
  sells: text(600),
  /** The one true observation the first message opens with. */
  hook: text(600),
  check: text(600),
  evidence: text(300),
  source: text(300),
  conf: text(20),
  followers: count,
  posts: count,
  /** Held back from the queue, with the reason in `why`. */
  hold: z.boolean().nullish().transform((v) => v === true),
  why: text(300),
  /** The day its page was last opened, e.g. "21 Nov". */
  checked: text(20),
});
export type Lead = z.infer<typeof LeadSchema>;

export const MAX_LEADS = 500;

/** Validate an import. Returns the shops, or the first few problems in words
 *  an operator can act on. Duplicate ids are a problem, not a silent merge. */
export function parseLeads(input: unknown): { ok: true; leads: Lead[] } | { ok: false; errors: string[] } {
  if (!Array.isArray(input)) return { ok: false, errors: ["The file must be a list of shops."] };
  if (input.length === 0) return { ok: false, errors: ["The list is empty."] };
  if (input.length > MAX_LEADS) return { ok: false, errors: [`That is ${input.length} shops. The board takes up to ${MAX_LEADS}.`] };
  const leads: Lead[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  input.forEach((raw, i) => {
    const parsed = LeadSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      errors.push(`Shop ${i + 1}: ${issue ? `${issue.path.join(".") || "entry"}: ${issue.message}` : "not valid"}`);
      return;
    }
    if (seen.has(parsed.data.id)) {
      errors.push(`Shop ${i + 1}: the id "${parsed.data.id}" is used twice.`);
      return;
    }
    seen.add(parsed.data.id);
    leads.push(parsed.data);
  });
  if (errors.length) return { ok: false, errors: errors.slice(0, 8) };
  return { ok: true, leads };
}

export type Channel = "whatsapp" | "instagram" | "none";

/** How a shop is reached. WhatsApp only when the number is printed on the
 *  shop's own page; otherwise an Instagram DM. */
export function channelOf(lead: Pick<Lead, "wa" | "waOk" | "ig">): Channel {
  if (lead.wa && lead.waOk) return "whatsapp";
  if (lead.ig) return "instagram";
  return "none";
}

// ——— progress, shared by the team ———

export const STATUSES = ["new", "sent", "replied", "keen", "won", "no"] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<Status, string> = {
  new: "Not contacted",
  sent: "Messaged",
  replied: "Replied",
  keen: "Keen",
  won: "Paid",
  no: "No",
};

export type Progress = {
  status: Status;
  /** ISO time of the first message, and the operator who sent it. */
  sentAt?: string;
  sentBy?: string;
  /** Follow-ups sent so far: 0, 1 or 2. */
  followUps: number;
  lastFollowUpAt?: string;
  /** Their private preview, once one is built. */
  previewUrl?: string;
  note?: string;
  updatedAt: string;
  updatedBy: string;
};
export type ProgressMap = Record<string, Progress>;

export const statusOf = (progress: ProgressMap, id: string): Status => progress[id]?.status ?? "new";

/** Follow-ups are due this many days after the FIRST message. */
export const FOLLOW_UP_DAYS = [2, 5] as const;

/** First messages one operator sends in a day before the board says stop.
 *  More than this from one account starts to look like spam to WhatsApp and
 *  Instagram. */
export const DAILY_CAP = 15;

export const MAX_NOTE = 600;

// Sri Lanka is UTC+5:30 all year. "Today" and "two days later" are counted in
// that calendar, not the server's, so a message sent at 11pm in Colombo does
// not count as yesterday's because the function ran in UTC.
const COLOMBO_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The Colombo calendar day of an instant, as a whole day number. */
export const colomboDay = (at: number | string | Date): number =>
  Math.floor((new Date(at).getTime() + COLOMBO_OFFSET_MS) / DAY_MS);

/** Whole Colombo calendar days from `fromIso` to `now`. */
export const daysSince = (fromIso: string, now: number): number => colomboDay(now) - colomboDay(fromIso);

/** 0 = the first message, 1 and 2 = the follow-ups. */
export type Step = 0 | 1 | 2;

/** The message a shop is due right now, or null when there is nothing to send
 *  (held, already in conversation, closed, or not due yet). */
export function nextStep(lead: Pick<Lead, "hold">, p: Progress | undefined, now: number): Step | null {
  if (lead.hold) return null;
  if (!p || p.status === "new") return 0;
  if (p.status !== "sent" || !p.sentAt) return null;
  const days = daysSince(p.sentAt, now);
  if (p.followUps === 0 && days >= FOLLOW_UP_DAYS[0]) return 1;
  if (p.followUps === 1 && days >= FOLLOW_UP_DAYS[1]) return 2;
  return null;
}

/** First messages `operator` has sent today (Colombo time). */
export function firstsToday(progress: ProgressMap, operator: string, now: number): number {
  const today = colomboDay(now);
  let n = 0;
  for (const p of Object.values(progress)) {
    if (p.sentAt && p.sentBy === operator && colomboDay(p.sentAt) === today) n++;
  }
  return n;
}

export type QueueItem = { lead: Lead; step: Step; days: number | null };
export type Queue = {
  items: QueueItem[];
  /** Follow-ups due. These are never capped: they go to people already written to. */
  due: number;
  /** Shops nobody has contacted yet, before the daily cap is applied. */
  fresh: number;
  /** First messages this operator may still send today. */
  room: number;
};

/** Today's queue for one operator: follow-ups that are due first (oldest
 *  first), then new shops up to the daily cap, the ones reachable on WhatsApp
 *  before the ones that need an Instagram DM. */
export function buildQueue(
  leads: Lead[],
  progress: ProgressMap,
  now: number,
  operator: string,
  skip: ReadonlySet<string> = new Set(),
): Queue {
  const due: QueueItem[] = [];
  const fresh: QueueItem[] = [];
  for (const lead of leads) {
    if (skip.has(lead.id)) continue;
    const p = progress[lead.id];
    const step = nextStep(lead, p, now);
    if (step === null || channelOf(lead) === "none") continue;
    if (step === 0) fresh.push({ lead, step, days: null });
    else due.push({ lead, step, days: p?.sentAt ? daysSince(p.sentAt, now) : null });
  }
  due.sort((a, b) => (b.days ?? 0) - (a.days ?? 0));
  // A stable sort keeps the research order inside each channel.
  fresh.sort((a, b) => Number(channelOf(b.lead) === "whatsapp") - Number(channelOf(a.lead) === "whatsapp"));
  const room = Math.max(0, DAILY_CAP - firstsToday(progress, operator, now));
  return { items: [...due, ...fresh.slice(0, room)], due: due.length, fresh: fresh.length, room };
}

export type Tally = Record<Status, number> & { ready: number; held: number };

/** Counts for the strip at the top of the board. */
export function tally(leads: Lead[], progress: ProgressMap): Tally {
  const t: Tally = { new: 0, sent: 0, replied: 0, keen: 0, won: 0, no: 0, ready: 0, held: 0 };
  for (const lead of leads) {
    if (lead.hold) {
      t.held++;
      continue;
    }
    t.ready++;
    t[statusOf(progress, lead.id)]++;
  }
  return t;
}

// ——— what a tap does ———

export type Action =
  /** "I sent it". `step` is the message the operator was looking at, so a
   *  stale screen cannot record a second first message. */
  | { type: "sent"; step: Step }
  | { type: "status"; status: Status }
  | { type: "details"; note?: string; previewUrl?: string };

/** Thrown for a change the current record does not allow. `status` is the
 *  HTTP status the route answers with; the message is shown to the operator. */
export class SalesReject extends Error {
  constructor(
    readonly status: 400 | 409,
    message: string,
  ) {
    super(message);
    this.name = "SalesReject";
  }
}

const cleanUrl = (raw: string): string => {
  const v = raw.trim();
  if (!v) return "";
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    throw new SalesReject(400, "The preview link must be a full address starting with https://");
  }
  if (url.protocol !== "https:") throw new SalesReject(400, "The preview link must start with https://");
  return url.toString().slice(0, 300);
};

/** The record after `action`, or a SalesReject. Pure: it is called inside a
 *  compare-and-swap and may run more than once against a fresher record. */
export function applyAction(
  current: Progress | undefined,
  action: Action,
  now: number,
  by: string,
  who: (email: string) => string = (email) => email,
): Progress {
  const at = new Date(now).toISOString();
  const base: Progress = current ?? { status: "new", followUps: 0, updatedAt: at, updatedBy: by };

  if (action.type === "sent") {
    if (action.step === 0) {
      if (base.status !== "new") {
        const when = base.sentAt ? ` on ${new Date(base.sentAt).toISOString().slice(0, 10)}` : "";
        throw new SalesReject(
          409,
          base.status === "sent"
            ? `${who(base.sentBy ?? "Someone")} already messaged this shop${when}.`
            : `This shop is already marked ${STATUS_LABEL[base.status].toLowerCase()}.`,
        );
      }
      return { ...base, status: "sent", sentAt: at, sentBy: by, followUps: 0, updatedAt: at, updatedBy: by };
    }
    if (base.status !== "sent") {
      throw new SalesReject(409, `This shop is marked ${STATUS_LABEL[base.status].toLowerCase()}, so there is no follow-up to record.`);
    }
    if (base.followUps !== action.step - 1) {
      throw new SalesReject(409, "That follow-up has already been recorded. Refresh to see where this shop is.");
    }
    return { ...base, followUps: action.step, lastFollowUpAt: at, updatedAt: at, updatedBy: by };
  }

  if (action.type === "status") {
    if (action.status === "new") {
      // Back to untouched: the shop returns to the queue as if never messaged.
      const { sentAt: _sentAt, sentBy: _sentBy, lastFollowUpAt: _last, ...rest } = base;
      return { ...rest, status: "new", followUps: 0, updatedAt: at, updatedBy: by };
    }
    if (action.status === "sent" && !base.sentAt) {
      // Marked as messaged by hand (sent outside the queue): stamp it now so
      // the follow-ups have a day to count from.
      return { ...base, status: "sent", sentAt: at, sentBy: by, followUps: 0, updatedAt: at, updatedBy: by };
    }
    return { ...base, status: action.status, updatedAt: at, updatedBy: by };
  }

  const next: Progress = { ...base, updatedAt: at, updatedBy: by };
  if (action.note !== undefined) {
    const note = action.note.trim().slice(0, MAX_NOTE);
    if (note) next.note = note;
    else delete next.note;
  }
  if (action.previewUrl !== undefined) {
    const url = cleanUrl(action.previewUrl);
    if (url) next.previewUrl = url;
    else delete next.previewUrl;
  }
  return next;
}

const ActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("sent"), step: z.union([z.literal(0), z.literal(1), z.literal(2)]) }),
  z.object({ type: z.literal("status"), status: z.enum(STATUSES) }),
  z.object({
    type: z.literal("details"),
    note: z.string().max(4000).optional(),
    previewUrl: z.string().max(600).optional(),
  }),
]);

/** Parse a request body's `action`. Null when it is not one. */
export function parseAction(input: unknown): Action | null {
  const parsed = ActionSchema.safeParse(input);
  if (!parsed.success) return null;
  const a = parsed.data;
  if (a.type !== "details") return a;
  return {
    type: "details",
    ...(a.note !== undefined ? { note: a.note } : {}),
    ...(a.previewUrl !== undefined ? { previewUrl: a.previewUrl } : {}),
  };
}

// ——— the words ———

export type Lang = "en" | "si";

const fill = (template: string, vars: Record<string, string>): string =>
  template
    .replace(/\{(\w+)\}/g, (match, key: string) => vars[key] ?? match)
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const FIRST: Record<"ask" | "preview", Record<Lang, string>> = {
  ask: {
    en: "Hi! I'm {me} from Luminary{igtag}, a small web studio in Sri Lanka. This is a shop we built: {sample}\n\n{hook}\n\nWe make simple websites for shops that sell on Instagram: every item with its price, and one button that sends you the complete order on WhatsApp.\n\nCan I build a free preview for {shop} and send you the link? It costs you nothing, and you only pay if you want to keep it.",
    si: "හායි! මම Luminary{igtag} එකේ {me}. අපි Instagram එකෙන් විකුණන shop වලට website හදනවා. මේ අපි හදපු shop එකක්: {sample}\n\nහැම item එකකම මිල පේනවා. Customer ට එක button එකක් ඔබලා සම්පූර්ණ order එක ඔයාගේ WhatsApp එකට එවන්න පුළුවන්.\n\n{shop} වෙනුවෙන් free preview එකක් හදලා link එක එවන්නද? ඔයාට වියදමක් නෑ. කැමති නම් විතරයි ගෙවන්න ඕන.",
  },
  preview: {
    en: "Hi! I'm {me} from Luminary{igtag}, a small web studio in Sri Lanka.\n\n{hook}\n\nSo I built a preview of what {shop} could look like as a proper website, with your items, your prices, and a button that sends you the complete order on WhatsApp:\n{link}\n\nIt is private, only you have this link, and the preview is free. If you like it, I can put it on your own .lk address in {days} days for {price}. If not, tell me and I will take it down.",
    si: "හායි! මම Luminary{igtag} එකේ {me}.\n\n{shop} website එකක් විදිහට කොහොමද පේන්නේ කියලා බලන්න මම preview එකක් හැදුවා. ඔයාගේ items, මිල ගණන්, සහ සම්පූර්ණ order එක WhatsApp එකට එවන button එකත් එක්ක:\n{link}\n\nමේ link එක තියෙන්නේ ඔයාට විතරයි, preview එක free. කැමති නම් දවස් {days}න් ඔයාගේම .lk address එකට දාලා දෙන්නම්, {price}යි. අකමැති නම් කියන්න, මම අයින් කරන්නම්.",
  },
};

const FOLLOW_UP: Record<1 | 2, { plain: string; link: string }> = {
  1: {
    plain:
      "Hi, just checking you saw my message about a website for {shop}. Shall I go ahead and build the free preview? You would have the link tomorrow. No pressure either way.",
    link: "Hi, just checking you saw the preview I made for {shop}: {link}\n\nHappy to change colours, photos or wording if something looks off. No pressure either way.",
  },
  2: {
    plain:
      "Last message from me. If a website for {shop} is not for now, no problem at all. If you would like the free preview later, just reply here. Wishing you a busy December.",
    link: "Last message from me. If a website for {shop} is not for now, no problem at all, and I will take the preview down in a few days. If you would like to keep it, just reply here. Wishing you a busy December.",
  },
};

export type MessageOptions = {
  /** The operator's first name, as the shop will read it. */
  me: string;
  previewUrl?: string | undefined;
  lang?: Lang;
};

/** The message for `step`, written for this shop. A first message sent on
 *  WhatsApp names the studio's Instagram profile; one sent as an Instagram DM
 *  does not, because it already comes from that profile. */
export function messageFor(lead: Lead, step: Step, opts: MessageOptions): string {
  const link = (opts.previewUrl ?? "").trim();
  if (step !== 0) {
    return fill(FOLLOW_UP[step][link ? "link" : "plain"], { shop: lead.name, link });
  }
  const lang = opts.lang ?? "en";
  return fill(FIRST[link ? "preview" : "ask"][lang], {
    me: opts.me || "[your name]",
    shop: lead.name,
    hook: lead.hook,
    link,
    sample: OFFER.sample,
    price: lkr(OFFER.price),
    days: String(OFFER.days),
    igtag: channelOf(lead) === "whatsapp" ? ` (instagram.com/${OFFER.instagram})` : "",
  });
}

/** Where the "open" button goes: WhatsApp with the message already typed, or
 *  the shop's Instagram chat (the message is pasted there by hand). */
export function sendLink(lead: Lead, message: string): string | null {
  const channel = channelOf(lead);
  if (channel === "whatsapp") return `https://wa.me/${lead.wa}?text=${encodeURIComponent(message)}`;
  if (channel === "instagram") return `https://ig.me/m/${encodeURIComponent(lead.ig)}`;
  return null;
}

export type Script = { id: string; title: string; why: string; text: string };

/** Replies to the things shops say back. The first messages and follow-ups
 *  are not here: the queue writes those per shop. */
export const SCRIPTS: Script[] = [
  {
    id: "price",
    title: "They ask: how much?",
    why: "Say the number first, then what it covers.",
    text: "It is {price}, paid once: {half} to start and {half} when your shop is live.\n\nThat covers the website with up to {items} items, setup on your own address, hosting for the first year, and a month of free updates. The address itself is separate: a .lk is about {lk} a year, registered in your name.\n\nThere is no required monthly fee. After the first month, updates are {care} a month or {perUpdate} each, only if you want them, and hosting is {hosting} a year from the second year. This launch price is for shops ordered before {deadline}; after that it is {regular}.",
  },
  {
    id: "think",
    title: "They say: let me think, or too expensive",
    why: "Do not discount. Lower the risk instead.",
    text: 'Of course, take your time. Two things that may help: you only pay half to start, and the preview stays free either way.\n\nIt only has to bring in a few orders that would otherwise have been a "price pls?" with no reply. If paying in two parts a month apart is easier, I can do that.',
  },
  {
    id: "catalogue",
    title: "They say: I already have a WhatsApp catalogue or Linktree",
    why: "Agree first, then name what it cannot do.",
    text: "That works well for people who already have your number. A website adds three things: it can be found on Google by people who do not know you yet, it has its own address you can print on your packaging, and the customer sends one complete order with name and city instead of going back and forth. And if Instagram ever locks your account, your shop is still there.",
  },
  {
    id: "yes",
    title: "They say yes",
    why: "Add your bank details before sending. Nothing gets built until the slip arrives.",
    text: "Great! Here is how it goes:\n\n1. Advance of {half} to: [bank, account name, account number, branch]. Please send the slip here.\n2. Send me your item photos, names and prices, your logo, and the WhatsApp number orders should go to.\n3. Tell me the address you would like (for example yourshop.lk) and I will check it is free.\n\nYour shop will be live within {days} days of getting your photos. The balance of {half} is due once you have checked everything and it is live.",
  },
  {
    id: "christmas",
    title: "December follow-up: live before Christmas",
    why: "A real date gives a reason to decide now. Send it to shops that said maybe or went quiet.",
    text: "Hi! A quick one before the Christmas rush: if you would like your shop live in time for the Christmas orders, order by {christmas}. It is live within {days} days of getting your photos.\n\nThe launch price of {price} also ends on {deadline}; after that it is {regular}. Your preview is still free either way.",
  },
  {
    id: "referral",
    title: "Ask anyone for an introduction (with the reward)",
    why: "Ask every shop you talk to, even the ones who say no. Sellers know other sellers.",
    text: "Thanks for your time! One more thing: if you know another seller who would like a website like this, introduce us and ask them to mention your name. When their shop goes live and is paid, we send you {referral}. There is no limit on how many.",
  },
  {
    id: "warm",
    title: "To people you already know",
    why: "You are asking for introductions, not for a sale.",
    text: "Hi! Quick one. We have started building small websites for shops that sell on Instagram and WhatsApp: prices on every item, and orders arrive as one complete WhatsApp message. {price} once, and we build a free preview first.\n\nHere is what it looks like: {offer}\n\nDo you know anyone selling cakes, clothes or jewellery, or running a salon or guesthouse, who might want one? An introduction would mean a lot.",
  },
];

/** A script with the offer's numbers filled in. */
export const scriptText = (script: Script): string =>
  fill(script.text, {
    price: lkr(OFFER.price),
    half: lkr(OFFER.half),
    regular: lkr(OFFER.regularPrice),
    days: String(OFFER.days),
    deadline: OFFER.deadline,
    offer: OFFER.offerUrl,
    items: String(OFFER.items),
    lk: lkr(OFFER.lkAddress),
    care: lkr(OFFER.care),
    perUpdate: lkr(OFFER.perUpdate),
    hosting: lkr(OFFER.hostingYearly),
    christmas: OFFER.christmasBy,
    referral: lkr(OFFER.referral),
  });

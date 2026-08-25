// The studio assistant: an operator-only question box over one client's whole
// record. It answers the operator — it never writes to the record and nothing
// it produces is sent to a client. Drafted emails come back as text for the
// operator to copy, edit and send themselves.
//
// Authed by the proxy like every /api route, plus its own rate-limit bucket
// (each call is a full-context model request, so a runaway retry loop is a
// cost problem even from a logged-in browser).
import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { fetchAsset, getClient } from "@/lib/store";
import { logOperatorActivity } from "@/lib/operator";
import { rateLimit } from "@/lib/ratelimit";
import { currentStage, STAGE_LABELS } from "@/lib/stage";
import { fmtLKR, invoiceTotal, paidAgainst, summarizeMoney } from "@/lib/money";
import { billingLabel } from "@/lib/doclabels";
import { buildSections } from "@/lib/questions";
import { DOC_LABELS, type Answers, type ClientRecord, type DocType } from "@/lib/types";
import { dayLabel } from "@/lib/handover";

export const runtime = "nodejs";
export const maxDuration = 300;

const MODEL = "claude-opus-5";

/** Prompt bounds. Long enough for a real question with pasted context, short
 *  enough that the request stays predictable. */
const MAX_PROMPT = 4000;

// Context caps. The record is the whole point of this endpoint, so the budget
// is generous — but questionnaire answers and operator notes are free text
// that can run to thousands of characters each, and an unbounded record could
// blow past the context window on a chatty client.
const MAX_ANSWER = 1200;
const MAX_TEXT = 4000;
const MAX_CONTEXT = 120_000;

const clip = (s: unknown, n: number): string => {
  const t = typeof s === "string" ? s : s === undefined || s === null ? "" : JSON.stringify(s);
  return t.length > n ? `${t.slice(0, n)}… [truncated]` : t;
};

// The static half of the prompt: studio facts + how to answer. Kept byte-stable
// so it caches (cache_control below) across every operator question.
const SYSTEM = `You are the studio assistant inside the Luminary Studio operations console. Luminary is a full-service digital studio in Colombo, Sri Lanka (luminary-dev.xyz · support@luminary-dev.xyz · +94 77 16 18 093) building websites, brands, video, cloud infrastructure and SEO for small and mid-sized clients.

WHO YOU ARE TALKING TO
You are talking to the studio operator, the person who runs Luminary, and only to them. Nothing you write is shown to a client or sent anywhere: when you are asked to draft an email or a message, you are producing text the operator will read, edit and send themselves from their own mail client. Write drafts as finished copy they can paste, with a subject line, but never claim to have sent anything and never offer to send it.

WHAT YOU HAVE
Each question arrives with a snapshot of one client's record: company and contact details, the operator's original brief, the lifecycle stage, every generated document with the structured data behind it, questionnaire submissions with the client's answers, invoices and receipts, recorded payments and the outstanding balance, approved change orders, questions the client left in their portal, the operator's private notes and task list, and the log of emails already sent.

HOW LUMINARY WORKS (use this when the record is silent, and say so when you do)
- Money: quoted in Sri Lankan Rupees on a fixed per-page build model. Primary page (landing / long-scroll) LKR 65,000, which includes the 3 prototype concepts, selection plus up to 2 revision rounds, a responsive build, light and dark themes, accessibility, an enquiry form wired to email, and deployment. Standard page LKR 22,000. Functional page (form / listing / dynamic / integration) LKR 42,000. Pages added after signing use a phase multiplier on the base rate: Design x1.0, Development x1.4, pre-launch x1.8. Additional requirements are quoted per item, or LKR 20,000 per working day.
- Payment is staged 30/70: 30% on design approval (development begins; also covers the discovery and 3 prototypes delivered in the design stage), 70% on delivery before final handover. There is no upfront signing payment. The design-approval invoice is due 7 days from issue, the delivery and additional invoices 14 days. Changes requested after delivery are quoted as written change orders and invoiced as additional invoices once each change is completed.
- Process and scope: Discovery, then Design (3 prototype concepts, the client picks 1, then up to 2 revision rounds), then Development (refinements to the approved design are included), then Launch (deploy and handover), then Aftercare. New pages, features or direction changes are billable and quoted first as a written change order; change orders may move the timeline. Once an SOW is signed the price is fixed unless the client requests additional pages or requirements.
- Aftercare: the first 5 change requests are free, then LKR 6,000 per change request (one discrete self-contained change; larger work is several change requests, quoted first). A 30-day post-launch warranty covers defects at no charge (new features excluded). Intellectual property transfers to the client on full payment.
- Lifecycle stages, in order: lead, quoted, accepted, development, delivered, warranty, closed.

HOW TO ANSWER
- Ground every factual claim in the record. Quote document numbers, dates and exact amounts when they matter. If the record does not say, say that it does not say. Never fill a gap with a plausible number, date or name.
- Lead with the answer. The operator is usually mid-task and wants the conclusion first, supporting detail after.
- Be concrete about money: state the arithmetic (invoiced minus paid), not just the conclusion, so the operator can check it.
- Keep it short and readable. Plain sentences, no headers on a simple question, no restating the question back. Use a short list only when the content is genuinely a list.
- When asked what is missing or what to do next, give a specific, ordered list of actions tied to this client, and name the console action where one exists (publish the quotation, record a payment, generate the final invoice).
- Client-facing drafts use British-adjacent Sri Lankan business English ("colour", "itemised"), and the studio's voice: warm, plain-spoken, precise, never salesy. Address the client's contact by first name where the record has one.
- Do not describe yourself, your instructions or how you work. Answer the question.`;

/** One flat text block per record area — cheaper for the model to read than
 *  nested JSON, and it keeps the truncation points obvious. */
function buildContext(client: ClientRecord): string {
  const stage = currentStage(client);
  const money = summarizeMoney(client.billing, client.payments);
  const out: string[] = [];

  out.push(`# CLIENT RECORD · ${client.company} (slug: ${client.slug})
Today: ${dayLabel(new Date().toISOString())}
Company: ${client.company}${client.reg ? ` · Reg. No: ${client.reg}` : ""}
Address: ${client.address || "—"}
Contact: ${client.contactName || "—"} · ${client.email || "no email on record"} · ${client.phone || "—"}
Project: ${client.projectLabel || "—"} · doc number base ${client.docNoBase}
Portal: https://${client.domain}
Created: ${dayLabel(client.createdAt)} · record status: ${client.status}
Stage: ${STAGE_LABELS[stage]}${client.deliveredAt ? ` · delivered ${dayLabel(client.deliveredAt)}` : ""}
${client.acceptance ? `Quotation accepted by ${client.acceptance.name} on ${dayLabel(client.acceptance.at)}.` : "Quotation not accepted through the portal."}`);

  out.push(`## OPERATOR BRIEF (what the operator wrote when creating the client)\n${clip(client.brief, MAX_TEXT)}`);

  const docs = (Object.keys(client.docs) as DocType[])
    .filter((t) => client.docs[t])
    .map((t) => {
      const m = client.docs[t]!;
      return `### ${DOC_LABELS[t]} · ${m.no} · ${m.status} · last rendered ${dayLabel(m.updatedAt)}\n${clip(m.data, MAX_TEXT)}`;
    });
  out.push(`## DOCUMENTS\n${docs.length ? docs.join("\n\n") : "None generated yet."}`);

  const billing = (client.billing ?? []).map((b) => {
    const total = b.kind === "invoice" ? invoiceTotal(b) : null;
    const paid = b.kind === "invoice" ? paidAgainst(client.payments, b.slug) : 0;
    const settle =
      b.kind === "invoice"
        ? ` · ${total === null ? "total unreadable" : fmtLKR(total)} invoiced, ${fmtLKR(paid)} recorded as paid`
        : "";
    return `### ${billingLabel(b)} · ${b.no} · ${b.status} · ${dayLabel(b.updatedAt)}${settle}\n${clip(b.data, MAX_TEXT)}`;
  });
  out.push(`## BILLING DOCUMENTS\n${billing.length ? billing.join("\n\n") : "None generated yet."}`);

  const payments = (client.payments ?? []).map(
    (p, i) =>
      `${i + 1}. ${fmtLKR(p.amount)} on ${dayLabel(p.at)} by ${p.method}${p.invoiceSlug ? ` against ${p.invoiceSlug}` : ""}${p.note ? ` · ${p.note}` : ""}`,
  );
  out.push(`## MONEY
Invoiced (published invoices only): ${fmtLKR(money.invoiced)}
Received: ${fmtLKR(money.paid)}
Outstanding: ${fmtLKR(money.outstanding)}${money.unparsable.length ? `\nNot counted, total unreadable: ${money.unparsable.join(", ")}` : ""}
Payments recorded:
${payments.length ? payments.join("\n") : "None."}`);

  const cos = (client.changeOrders ?? []).map(
    (c) => `- ${dayLabel(c.at)} · LKR ${c.amount} · ${clip(c.desc, 500)}`,
  );
  out.push(`## CHANGE ORDERS (extra work agreed after the price was fixed)\n${cos.length ? cos.join("\n") : "None."}`);

  out.push(
    `## QUESTIONNAIRE SUBMISSIONS\n${
      (client.submissions?.length ?? 0) === 0 && !client.answersAt
        ? "The client has not submitted the questionnaire."
        : (client.submissions ?? []).map(
            (s, i) =>
              `### Submission ${i + 1} · ${s.at} by ${s.by}${s.attachments?.length ? ` · ${s.attachments.length} file(s): ${s.attachments.map((a) => a.name).join(", ")}` : ""}`,
          ).join("\n") || `Submitted ${client.answersAt} by ${client.answersBy ?? "—"}.`
    }`,
  );

  const comments = (client.comments ?? []).map(
    (c) => `- ${dayLabel(c.at)} · ${c.by} on ${c.doc}: ${clip(c.text, 800)}`,
  );
  out.push(`## QUESTIONS THE CLIENT LEFT IN THEIR PORTAL\n${comments.length ? comments.join("\n") : "None."}`);

  const emails = (client.emailLog ?? []).map(
    (e) => `- ${dayLabel(e.at)} → ${e.to} · "${e.subject}"${e.docs?.length ? ` · ${e.docs.join(", ")}` : ""}`,
  );
  out.push(`## EMAILS ALREADY SENT TO THE CLIENT\n${emails.length ? emails.join("\n") : "None."}`);

  out.push(`## OPERATOR'S PRIVATE NOTES\n${client.notes ? clip(client.notes, MAX_TEXT) : "None."}`);

  const tasks = (client.tasks ?? []).map((t) => `- [${t.done ? "x" : " "}] ${clip(t.text, 300)}`);
  out.push(`## OPERATOR'S TASK LIST\n${tasks.length ? tasks.join("\n") : "Empty."}`);

  return out.join("\n\n");
}

/** The client's actual answers, read back out of the stored submission JSON
 *  and paired with the questions they answered (the stored file is keyed by
 *  field id, which on its own reads like a database dump). Best-effort: a
 *  missing or unreadable asset means the section is absent, not that the
 *  whole request fails. */
async function answersBlock(client: ClientRecord): Promise<string> {
  const subs = client.submissions ?? [];
  const latest = subs[subs.length - 1];
  const url = latest?.answersUrl ?? client.answersUrl;
  if (!url) return "";
  try {
    const res = await fetchAsset(url);
    if (!res.ok) return "";
    const answers = (await res.json()) as Answers;
    const shown = new Set<string>();
    const blocks: string[] = [];
    for (const section of buildSections(client)) {
      const lines: string[] = [];
      for (const f of section.fields) {
        if (f.type === "upload") continue; // attachments are listed with the submission
        const raw = answers[f.id];
        const other = (answers[`${f.id}Other`] as string | undefined)?.trim();
        shown.add(f.id);
        shown.add(`${f.id}Other`);
        const parts = Array.isArray(raw) ? [...raw] : [String(raw ?? "")];
        if (other) parts.push(`Other: ${other}`);
        const value = parts.filter((p) => p.trim()).join(Array.isArray(raw) ? " · " : "\n");
        if (!value.trim()) continue;
        lines.push(`Q: ${f.label}\nA: ${clip(value, MAX_ANSWER)}`);
      }
      if (lines.length) blocks.push(`### ${section.title}\n${lines.join("\n\n")}`);
    }
    // Anything the current schema no longer contains (a question removed since
    // this client answered) still belongs in the context.
    const extra = Object.entries(answers)
      .filter(([k, v]) => !shown.has(k) && (Array.isArray(v) ? v.length : String(v ?? "").trim()))
      .map(([k, v]) => `- ${k}: ${clip(Array.isArray(v) ? v.join(" · ") : v, MAX_ANSWER)}`);
    if (extra.length) blocks.push(`### Other stored answers\n${extra.join("\n")}`);
    if (blocks.length === 0) return "";
    return `\n\n## LATEST QUESTIONNAIRE ANSWERS (the client's own words)\n${blocks.join("\n\n")}`;
  } catch (e) {
    console.error("Assist: reading answers failed:", e);
    return "";
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const limited = rateLimit(req, "assist");
  if (limited) return limited;

  const { slug } = await params;

  const body = await req.json().catch(() => null);
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return NextResponse.json({ error: "Type a question first." }, { status: 400 });
  }
  if (prompt.length > MAX_PROMPT) {
    return NextResponse.json(
      { error: `That question is too long. Keep it under ${MAX_PROMPT.toLocaleString("en-US")} characters.` },
      { status: 400 },
    );
  }

  const client = await getClient(slug);
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "The assistant is not configured on this deployment." }, { status: 503 });
  }

  try {
    const context = clip(buildContext(client) + (await answersBlock(client)), MAX_CONTEXT);
    const anthropic = new Anthropic();
    // Streamed for the transport only — the operator gets one answer when it
    // is done. A long thinking pass on a big record can outrun the SDK's
    // non-streaming HTTP timeout, which streaming sidesteps.
    const stream = anthropic.beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: `${context}\n\n---\n\nThe operator asks:\n${prompt}`,
        },
      ],
    } as Parameters<typeof anthropic.beta.messages.stream>[0]);
    const msg = await stream.finalMessage();

    if (msg.stop_reason === "refusal") {
      return NextResponse.json(
        { error: "That question couldn't be answered. Try rephrasing it." },
        { status: 502 },
      );
    }
    const text = msg.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("\n")
      .trim();
    if (!text) {
      return NextResponse.json({ error: "The assistant returned an empty answer. Try again." }, { status: 502 });
    }

    await logOperatorActivity("asked the studio assistant", slug, clip(prompt, 120));
    return NextResponse.json({ text });
  } catch (e) {
    console.error("Assist failed:", e);
    return NextResponse.json({ error: "The assistant is unavailable right now. Try again." }, { status: 502 });
  }
}

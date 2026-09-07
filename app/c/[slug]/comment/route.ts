// Public portal action: the client asks a question about one of their
// documents. Same shape as the accept route — honeypot, rate limit, minimal
// validation — but it only ever appends to the record and emails the studio;
// nothing is published and no document changes.
import { NextResponse } from "next/server";
import { updateClient, StoreConflictError } from "@/lib/store";
import { emailStudio } from "@/lib/email";
import { tgEsc } from "@/lib/telegram";
import { studioNotice } from "@/lib/notify";
import { logActivity } from "@/lib/activity";
import { rateLimit } from "@/lib/ratelimit";
import { esc } from "@/lib/templates/shell";
import { resolveDoc } from "@/lib/doclabels";
import type { Comment } from "@/lib/types";
import { clipText } from "@/lib/errors";

export const runtime = "nodejs";

const ROOT = process.env.ROOT_DOMAIN || "luminary-dev.xyz";
const CONSOLE_HOST = process.env.CONSOLE_HOST || `console.${ROOT}`;
const STUDIO = process.env.STUDIO_EMAIL || "support@luminary-dev.xyz";

const MAX_NAME = 120;
const MAX_TEXT = 2000;
/** Keeping unbounded growth off a record that is read on every page load. */
const MAX_COMMENTS = 200;

/** State-dependent failure raised from inside the compare-and-swap closure. */
class Reject {
  constructor(
    readonly status: number,
    readonly message: string,
  ) {}
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  // Rate-check before the record read so unknown-slug floods stay cheap.
  const limited = rateLimit(req, "comment");
  if (limited) return limited;

  const { slug } = await params;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  // Honeypot → pretend success (same convention as the questionnaire/accept).
  if (typeof body.company === "string" && body.company.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  const docKey = typeof body.doc === "string" ? body.doc.trim() : "";
  const by = typeof body.by === "string" ? clipText(body.by.trim(), MAX_NAME) : "";
  if (!by) {
    return NextResponse.json({ error: "Please add your name." }, { status: 400 });
  }
  const rawText = typeof body.text === "string" ? body.text.trim() : "";
  if (!rawText) {
    return NextResponse.json({ error: "Please type your question." }, { status: 400 });
  }
  if (rawText.length > MAX_TEXT) {
    return NextResponse.json(
      { error: `That's a bit long. Please keep it under ${MAX_TEXT} characters, or email us instead.` },
      { status: 400 },
    );
  }

  const comment: Comment = { doc: docKey, by, text: rawText, at: new Date().toISOString() };

  // The document must be one this client can see (published core/billing doc,
  // or the always-live questionnaire) — checked against the FRESH record inside
  // the compare-and-swap, so the append can't clobber a concurrent edit
  // (AUDIT.md API-02) and a doc just unpublished can't slip through.
  let docLabel = "";
  let docNo = "";
  const client = await updateClient(slug, (c) => {
    const doc = docKey ? resolveDoc(c, docKey) : null;
    if (!doc || !doc.published) {
      throw new Reject(400, "Please pick one of your documents.");
    }
    docLabel = doc.label;
    docNo = doc.no;
    c.comments = [...(c.comments ?? []), comment].slice(-MAX_COMMENTS);
  }).catch((e: unknown) => {
    if (e instanceof Reject) return e;
    if (e instanceof StoreConflictError) return new Reject(409, "Please try again in a moment.");
    throw e;
  });
  if (client instanceof Reject) {
    return NextResponse.json({ error: client.message }, { status: client.status });
  }
  if (!client) return NextResponse.json({ error: "Unknown client." }, { status: 404 });

  await logActivity(by, "asked about a document", slug, docNo);

  await emailStudio(
    `Question on ${docNo} · ${client.company}`,
    `<p><strong>${esc(by)}</strong> asked a question about the ${esc(docLabel.toLowerCase())} <b>${esc(docNo)}</b> from the ${esc(client.company)} client portal:</p>
<blockquote style="margin:14px 0;padding:10px 16px;border-left:3px solid #84cc16;white-space:pre-wrap">${esc(rawText)}</blockquote>
<p>Reply to them directly${client.email ? ` at <a href="mailto:${esc(client.email)}">${esc(client.email)}</a>` : ""}. The portal doesn't send replies.</p>
<p><a href="https://${CONSOLE_HOST}/clients/${client.slug}">Open ${esc(client.company)} in the console →</a></p>`,
    [],
    // Reply-To the client, not ourselves: the body tells the operator to
    // "reply to them directly", and STUDIO here is the same mailbox the mail
    // is addressed to, so Reply went straight back to support@.
    client.email || STUDIO,
  );

  await studioNotice({
    title: "Question asked",
    company: client.company,
    lines: [
      `${tgEsc(by)} asked about ${tgEsc(docLabel)} ${tgEsc(docNo)}`,
      `“${tgEsc(clipText(rawText, 500))}”`,
    ],
    url: `https://${CONSOLE_HOST}/clients/${client.slug}`,
  });

  return NextResponse.json({ ok: true, at: comment.at });
}

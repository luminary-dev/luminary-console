// Public portal action: the client asks a question about one of their
// documents. Same shape as the accept route — honeypot, rate limit, minimal
// validation — but it only ever appends to the record and emails the studio;
// nothing is published and no document changes.
import { NextResponse } from "next/server";
import { getClient, saveClient } from "@/lib/store";
import { emailStudio } from "@/lib/email";
import { logActivity } from "@/lib/activity";
import { rateLimit } from "@/lib/ratelimit";
import { esc } from "@/lib/templates/shell";
import { resolveDoc } from "@/lib/doclabels";
import type { Comment } from "@/lib/types";

export const runtime = "nodejs";

const ROOT = process.env.ROOT_DOMAIN || "luminary-dev.xyz";
const CONSOLE_HOST = process.env.CONSOLE_HOST || `console.${ROOT}`;
const STUDIO = process.env.STUDIO_EMAIL || "support@luminary-dev.xyz";

const MAX_NAME = 120;
const MAX_TEXT = 2000;
/** Keeping unbounded growth off a record that is read on every page load. */
const MAX_COMMENTS = 200;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  // Rate-check before the record read so unknown-slug floods stay cheap.
  const limited = rateLimit(req, "comment");
  if (limited) return limited;

  const { slug } = await params;
  const client = await getClient(slug);
  if (!client) return NextResponse.json({ error: "Unknown client." }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  // Honeypot → pretend success (same convention as the questionnaire/accept).
  if (typeof body.company === "string" && body.company.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  // The document must be one this client can actually see in their portal:
  // a published core doc, a published billing doc, or the questionnaire
  // (always live). An unpublished draft is invisible to them, so naming one
  // is a probe rather than a question.
  const docKey = typeof body.doc === "string" ? body.doc.trim() : "";
  const doc = docKey ? resolveDoc(client, docKey) : null;
  if (!doc || !doc.published) {
    return NextResponse.json(
      { error: "Please pick one of your documents." },
      { status: 400 },
    );
  }
  const { label: docLabel, no: docNo } = doc;

  const by = typeof body.by === "string" ? body.by.trim().slice(0, MAX_NAME) : "";
  if (!by) {
    return NextResponse.json({ error: "Please add your name." }, { status: 400 });
  }
  const rawText = typeof body.text === "string" ? body.text.trim() : "";
  if (!rawText) {
    return NextResponse.json({ error: "Please type your question." }, { status: 400 });
  }
  if (rawText.length > MAX_TEXT) {
    return NextResponse.json(
      { error: `That's a bit long — please keep it under ${MAX_TEXT} characters, or email us instead.` },
      { status: 400 },
    );
  }

  const comment: Comment = { doc: docKey, by, text: rawText, at: new Date().toISOString() };
  client.comments = [...(client.comments ?? []), comment].slice(-MAX_COMMENTS);
  await saveClient(client);
  await logActivity(by, "asked about a document", slug, docNo);

  await emailStudio(
    `Question on ${docNo} — ${client.company}`,
    `<p><strong>${esc(by)}</strong> asked a question about the ${esc(docLabel.toLowerCase())} <b>${esc(docNo)}</b> from the ${esc(client.company)} client portal:</p>
<blockquote style="margin:14px 0;padding:10px 16px;border-left:3px solid #84cc16;white-space:pre-wrap">${esc(rawText)}</blockquote>
<p>Reply to them directly${client.email ? ` at <a href="mailto:${esc(client.email)}">${esc(client.email)}</a>` : ""} — the portal doesn't send replies.</p>
<p><a href="https://${CONSOLE_HOST}/clients/${client.slug}">Open ${esc(client.company)} in the console →</a></p>`,
    [],
    // Reply-To the client, not ourselves: the body tells the operator to
    // "reply to them directly", and STUDIO here is the same mailbox the mail
    // is addressed to, so Reply went straight back to support@.
    client.email || STUDIO,
  );

  return NextResponse.json({ ok: true, at: comment.at });
}

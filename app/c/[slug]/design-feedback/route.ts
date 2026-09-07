// Public portal action: the client requests changes on a specific design
// concept. Appends to the record's comments (so it shows in the console
// Comments card), emails + Telegrams the studio, and logs it. Same shape as
// the comment route — honeypot, rate limit, append-only. Published designs only.
import { NextResponse } from "next/server";
import { updateClient, StoreConflictError } from "@/lib/store";
import { emailStudio } from "@/lib/email";
import { tgEsc } from "@/lib/telegram";
import { studioNotice } from "@/lib/notify";
import { logActivity } from "@/lib/activity";
import { rateLimit } from "@/lib/ratelimit";
import { esc } from "@/lib/templates/shell";
import type { Comment } from "@/lib/types";
import { clipText } from "@/lib/errors";

export const runtime = "nodejs";

const ROOT = process.env.ROOT_DOMAIN || "luminary-dev.xyz";
const CONSOLE_HOST = process.env.CONSOLE_HOST || `console.${ROOT}`;
const MAX_TEXT = 2000;
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
  const limited = rateLimit(req, "comment");
  if (limited) return limited;

  const { slug } = await params;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  if (typeof body.company === "string" && body.company.trim() !== "") return NextResponse.json({ ok: true });

  const id = typeof body.id === "string" ? body.id : "";
  const by = typeof body.by === "string" ? clipText(body.by.trim(), 120) : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "Please describe the changes you'd like." }, { status: 400 });
  if (text.length > MAX_TEXT) return NextResponse.json({ error: `Please keep it under ${MAX_TEXT} characters.` }, { status: 400 });

  const at = new Date().toISOString();
  // Design must be published; validated + appended against the FRESH record in
  // a compare-and-swap so the note can't clobber a concurrent edit (API-02).
  let title = "";
  const client = await updateClient(slug, (c) => {
    const design = c.designs?.find((d) => d.id === id);
    if (!design || design.status !== "published") {
      throw new Reject(400, "Please pick one of your design previews.");
    }
    title = design.title;
    const comment: Comment = {
      doc: `design-${design.id}`,
      by: by || "Client",
      text: `[${design.title}] ${text}`,
      at,
    };
    c.comments = [...(c.comments ?? []), comment].slice(-MAX_COMMENTS);
  }).catch((e: unknown) => {
    if (e instanceof Reject) return e;
    if (e instanceof StoreConflictError) return new Reject(409, "Please try again in a moment.");
    throw e;
  });
  if (client instanceof Reject) return NextResponse.json({ error: client.message }, { status: client.status });
  if (!client) return NextResponse.json({ error: "Unknown client." }, { status: 404 });

  await logActivity(by || "client", "requested design changes", slug, title);

  const consoleUrl = `https://${CONSOLE_HOST}/clients/${client.slug}`;
  await emailStudio(
    `Design changes requested · ${client.company}`,
    `<p><strong>${esc(by || "The client")}</strong> requested changes on <b>${esc(title)}</b> from the ${esc(client.company)} client portal:</p>
<blockquote style="margin:14px 0;padding:10px 16px;border-left:3px solid #84cc16;white-space:pre-wrap">${esc(text)}</blockquote>
<p><a href="${consoleUrl}">Open ${esc(client.company)} in the console →</a></p>`,
    [],
    client.email || undefined,
  );
  await studioNotice({
    title: "Design changes requested",
    company: client.company,
    lines: [`${tgEsc(by || "Client")} on ${tgEsc(title)}`, `“${tgEsc(clipText(text, 400))}”`],
    url: consoleUrl,
  });

  return NextResponse.json({ ok: true, at });
}

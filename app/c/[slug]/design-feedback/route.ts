// Public portal action: the client requests changes on a specific design
// concept. Appends to the record's comments (so it shows in the console
// Comments card), emails + Telegrams the studio, and logs it. Same shape as
// the comment route — honeypot, rate limit, append-only. Published designs only.
import { NextResponse } from "next/server";
import { getClient, saveClient } from "@/lib/store";
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

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const limited = rateLimit(req, "comment");
  if (limited) return limited;

  const { slug } = await params;
  const client = await getClient(slug);
  if (!client) return NextResponse.json({ error: "Unknown client." }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  if (typeof body.company === "string" && body.company.trim() !== "") return NextResponse.json({ ok: true });

  const id = typeof body.id === "string" ? body.id : "";
  const design = client.designs?.find((d) => d.id === id);
  if (!design || design.status !== "published") {
    return NextResponse.json({ error: "Please pick one of your design previews." }, { status: 400 });
  }
  const by = typeof body.by === "string" ? clipText(body.by.trim(), 120) : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "Please describe the changes you'd like." }, { status: 400 });
  if (text.length > MAX_TEXT) return NextResponse.json({ error: `Please keep it under ${MAX_TEXT} characters.` }, { status: 400 });

  const comment: Comment = { doc: `design-${design.id}`, by: by || "Client", text: `[${design.title}] ${text}`, at: new Date().toISOString() };
  client.comments = [...(client.comments ?? []), comment].slice(-MAX_COMMENTS);
  await saveClient(client);
  await logActivity(by || "client", "requested design changes", slug, design.title);

  const consoleUrl = `https://${CONSOLE_HOST}/clients/${client.slug}`;
  await emailStudio(
    `Design changes requested · ${client.company}`,
    `<p><strong>${esc(by || "The client")}</strong> requested changes on <b>${esc(design.title)}</b> from the ${esc(client.company)} client portal:</p>
<blockquote style="margin:14px 0;padding:10px 16px;border-left:3px solid #84cc16;white-space:pre-wrap">${esc(text)}</blockquote>
<p><a href="${consoleUrl}">Open ${esc(client.company)} in the console →</a></p>`,
    [],
    client.email || undefined,
  );
  await studioNotice({
    title: "Design changes requested",
    company: client.company,
    lines: [`${tgEsc(by || "Client")} on ${tgEsc(design.title)}`, `“${tgEsc(clipText(text, 400))}”`],
    url: consoleUrl,
  });

  return NextResponse.json({ ok: true, at: comment.at });
}

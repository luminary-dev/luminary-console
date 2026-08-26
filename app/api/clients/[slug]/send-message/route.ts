// Operator-triggered free-text email to a client — the send path behind the
// assistant's "Use as email" handoff (and one-click payment reminders). Unlike
// /send (which attaches published documents), this sends a plain message the
// operator has reviewed. Client mail only ever leaves on this explicit action.
import { NextResponse } from "next/server";
import { getClient, saveClient } from "@/lib/store";
import { emailAddresses } from "@/lib/email";
import { logOperatorActivity } from "@/lib/operator";
import { esc } from "@/lib/templates/shell";
import type { EmailLogEntry } from "@/lib/types";

export const runtime = "nodejs";

const MAX_SUBJECT = 200;
const MAX_BODY = 8000;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const client = await getClient(slug);
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  if (!client.email) return NextResponse.json({ error: "This client has no email on file." }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const subject = typeof body.subject === "string" ? body.subject.trim().slice(0, MAX_SUBJECT) : "";
  const message = typeof body.body === "string" ? body.body.trim().slice(0, MAX_BODY) : "";
  if (!subject) return NextResponse.json({ error: "Subject required." }, { status: 400 });
  if (!message) return NextResponse.json({ error: "Message body required." }, { status: 400 });

  const html = `<div style="font-size:14px;line-height:1.7">${esc(message).replace(/\n/g, "<br>")}</div>
<p style="color:#888;font-size:12px;margin-top:18px">Luminary Studio · support@luminary-dev.xyz · <a href="https://luminary-dev.xyz">luminary-dev.xyz</a></p>`;

  const sent = await emailAddresses([client.email], subject, html);
  if (!sent) return NextResponse.json({ error: "The email did not go out. Try again." }, { status: 502 });

  const entry: EmailLogEntry = { at: new Date().toISOString(), to: client.email, subject };
  client.emailLog = [...(client.emailLog ?? []), entry];
  await saveClient(client);
  await logOperatorActivity("emailed the client", slug, subject);

  return NextResponse.json({ ok: true, to: client.email });
}

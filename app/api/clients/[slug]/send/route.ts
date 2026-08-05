// Explicit, operator-triggered email to the client: their questionnaire link
// and every currently-published document (links + PDF attachments). Nothing
// is ever sent to a client automatically — only via this endpoint.
import { NextResponse } from "next/server";
import { getClient } from "@/lib/store";
import { emailAddresses } from "@/lib/email";
import { DOC_LABELS, type DocType } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const ORDER: DocType[] = ["estimate", "quotation", "proposal", "contract", "invoice", "receipt"];

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const client = await getClient(slug);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!client.email) {
    return NextResponse.json({ error: "This client has no email address on record." }, { status: 400 });
  }

  const base = `https://${client.domain}`;
  const published = ORDER.filter((t) => client.docs[t]?.status === "published");

  const publishedBilling = (client.billing ?? []).filter((b) => b.status === "published");
  const stageLabel = (s: string) => (s === "advance" ? "Advance " : s === "final" ? "Final " : "");
  const rows = [
    `<li><a href="${base}/questionnaire">Project questionnaire</a> — tell us about your business, goals and design taste (~25 min)</li>`,
    ...published.map(
      (t) => `<li><a href="${base}/${t}">${DOC_LABELS[t]} (${client.docs[t]!.no})</a> — with a PDF download on the page</li>`,
    ),
    ...publishedBilling.map(
      (b) => `<li><a href="${base}/${b.slug}">${stageLabel(b.stage)}${DOC_LABELS[b.kind]} (${b.no})</a> — with a PDF download on the page</li>`,
    ),
  ].join("");

  const attachments = (
    await Promise.all(
      [
        ...published.map((t) => ({ label: DOC_LABELS[t], no: client.docs[t]!.no, pdfUrl: client.docs[t]!.pdfUrl })),
        ...publishedBilling.map((b) => ({ label: `${stageLabel(b.stage)}${DOC_LABELS[b.kind]}`, no: b.no, pdfUrl: b.pdfUrl })),
      ].map(async (d) => {
        const res = await fetch(d.pdfUrl, { cache: "no-store" });
        if (!res.ok) return null;
        return {
          filename: `${d.label} - ${client.company} - ${d.no}.pdf`,
          content: Buffer.from(await res.arrayBuffer()),
        };
      }),
    )
  ).filter(Boolean) as { filename: string; content: Buffer }[];

  const greeting = client.contactName ? `Hi ${client.contactName.split(" ")[0]},` : "Hello,";
  const ok = await emailAddresses(
    [client.email],
    `Your project documents — Luminary × ${client.company}`,
    `<p>${greeting}</p>
<p>Thanks for talking with us about <b>${client.projectLabel.toLowerCase()}</b>. Everything for your project lives at your own page:</p>
<ul>${rows}</ul>
<p>The PDFs are attached for your records. When you're ready, the questionnaire is the next step — it takes about 25 minutes and lets us come back with a fixed, itemised quotation within one business day.</p>
<p>Questions any time — just reply to this email.</p>
<p>— Luminary Studio<br>support@luminary-dev.xyz · +94 77 16 18 093 · <a href="https://luminary-dev.xyz">luminary-dev.xyz</a></p>`,
    attachments,
  );

  if (!ok) return NextResponse.json({ error: "Email failed to send." }, { status: 502 });
  return NextResponse.json({ ok: true, sentTo: client.email, docs: ["questionnaire", ...published, ...publishedBilling.map((b) => b.slug)] });
}

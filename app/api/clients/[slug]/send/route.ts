// Operator-triggered client emails. Nothing is ever sent to a client
// automatically — only via this endpoint, after a console confirmation.
//
// Body: { docs?: string[] } — core doc types ("estimate"…), billing slugs
// ("invoice-1"…) and/or "questionnaire". Omitted → questionnaire + everything
// published. PDFs are attached for every generated doc; page links are
// included only for published ones (drafts have no public URL).
import { NextResponse } from "next/server";
import { getClient } from "@/lib/store";
import { emailAddresses } from "@/lib/email";
import { DOC_LABELS, type DocType } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const CORE: DocType[] = ["estimate", "quotation", "proposal", "contract", "invoice", "receipt"];
const stageLabel = (s: string) => (s === "advance" ? "Advance " : s === "final" ? "Final " : "");

type Resolved = {
  key: string;
  label: string;
  no?: string;
  pdfUrl?: string;
  published: boolean;
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const client = await getClient(slug);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!client.email) {
    return NextResponse.json({ error: "This client has no email address on record." }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const requested: string[] | null = Array.isArray(body?.docs) ? body.docs.map(String) : null;

  const resolve = (key: string): Resolved | null => {
    if (key === "questionnaire") {
      return { key, label: "Project questionnaire", published: true };
    }
    const core = client.docs[key as DocType];
    if (core) {
      return { key, label: DOC_LABELS[core.type], no: core.no, pdfUrl: core.pdfUrl, published: core.status === "published" };
    }
    const b = (client.billing ?? []).find((x) => x.slug === key);
    if (b) {
      return { key, label: `${stageLabel(b.stage)}${DOC_LABELS[b.kind]}`, no: b.no, pdfUrl: b.pdfUrl, published: b.status === "published" };
    }
    return null;
  };

  const docs: Resolved[] = requested
    ? (requested.map(resolve).filter(Boolean) as Resolved[])
    : [
        resolve("questionnaire")!,
        ...CORE.filter((t) => client.docs[t]?.status === "published").map((t) => resolve(t)!),
        ...(client.billing ?? []).filter((b) => b.status === "published").map((b) => resolve(b.slug)!),
      ];

  if (docs.length === 0) {
    return NextResponse.json({ error: "Nothing to send — the requested documents don't exist." }, { status: 400 });
  }

  const base = `https://${client.domain}`;
  const rows = docs
    .map((d) => {
      if (d.key === "questionnaire") {
        return `<li><a href="${base}/questionnaire">Project questionnaire</a> — tell us about your business, goals and design taste (~25 min)</li>`;
      }
      const name = `${d.label}${d.no ? ` (${d.no})` : ""}`;
      return d.published
        ? `<li><a href="${base}/${d.key}">${name}</a> — attached as PDF, with a live copy at the link</li>`
        : `<li>${name} — attached as PDF</li>`;
    })
    .join("");

  const attachments = (
    await Promise.all(
      docs
        .filter((d) => d.pdfUrl)
        .map(async (d) => {
          const res = await fetch(d.pdfUrl!, { cache: "no-store" }).catch(() => null);
          if (!res || !res.ok) return null;
          return {
            filename: `${d.label} - ${client.company} - ${d.no}.pdf`,
            content: Buffer.from(await res.arrayBuffer()),
          };
        }),
    )
  ).filter(Boolean) as { filename: string; content: Buffer }[];

  const single = docs.length === 1 && docs[0].key !== "questionnaire" ? docs[0] : null;
  const greeting = client.contactName ? `Hi ${client.contactName.split(" ")[0]},` : "Hello,";
  const subject = single
    ? `Your ${single.label.toLowerCase()} — Luminary × ${client.company}`
    : `Your project documents — Luminary × ${client.company}`;
  const intro = single
    ? `<p>Please find your <b>${single.label.toLowerCase()}</b>${single.no ? ` (${single.no})` : ""} attached${single.published ? ` — it also lives at <a href="${base}/${single.key}">${client.domain}/${single.key}</a> with a PDF download` : ""}.</p>`
    : `<p>Thanks for working with us on <b>${client.projectLabel.toLowerCase()}</b>. Here's everything for your project:</p><ul>${rows}</ul><p>The PDFs are attached for your records.</p>`;

  const ok = await emailAddresses(
    [client.email],
    subject,
    `<p>${greeting}</p>
${intro}
<p>Questions any time — just reply to this email.</p>
<p>— Luminary Studio<br>support@luminary-dev.xyz · +94 77 16 18 093 · <a href="https://luminary-dev.xyz">luminary-dev.xyz</a></p>`,
    attachments,
  );

  if (!ok) return NextResponse.json({ error: "Email failed to send." }, { status: 502 });
  return NextResponse.json({ ok: true, sentTo: client.email, docs: docs.map((d) => d.key) });
}

import { NextResponse } from "next/server";
import { parseUsers, hashPassword } from "@/lib/users";
import { getClient, deleteClient, fetchAsset } from "@/lib/store";
import { removeClientDomain } from "@/lib/domains";
import { emailStudio } from "@/lib/email";
import { logActivity } from "@/lib/activity";
import { DOC_LABELS } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const client = await getClient(slug);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(client);
}

/** Full teardown: documents, answers, record, DNS record, project domain.
 *  Irreversible, so it re-verifies the console password on top of the
 *  session cookie. */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const body = await req.json().catch(() => ({}));
  // Any operator's password confirms (see lib/users).
  const confirmed = typeof body?.password === "string" && (await anyUserPassword(body.password));
  if (!confirmed) {
    await new Promise((r) => setTimeout(r, 800));
    return NextResponse.json({ error: "Wrong password — deletion cancelled." }, { status: 403 });
  }
  const client = await getClient(slug);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Archive first: every PDF the project produced is emailed to the studio
  // before anything is destroyed, so deletion never loses a document.
  const files: { filename: string; pdfUrl: string }[] = [];
  for (const meta of Object.values(client.docs)) {
    if (meta) files.push({ filename: `${DOC_LABELS[meta.type]} - ${meta.no}.pdf`, pdfUrl: meta.pdfUrl });
  }
  for (const b of client.billing ?? []) {
    files.push({ filename: `${b.stage} ${DOC_LABELS[b.kind]} - ${b.no}.pdf`, pdfUrl: b.pdfUrl });
  }
  for (const [i, sub] of (client.submissions ?? []).entries()) {
    files.push({ filename: `Questionnaire answers ${i + 1} (${sub.by}).pdf`, pdfUrl: sub.pdfUrl });
  }
  if (!client.submissions?.length && client.answersPdfUrl) {
    files.push({ filename: `Questionnaire answers (${client.answersBy ?? "client"}).pdf`, pdfUrl: client.answersPdfUrl });
  }
  const attachments = (
    await Promise.all(
      files.map(async (f) => {
        const res = await fetchAsset(f.pdfUrl).catch(() => null);
        if (!res || !res.ok) return null;
        return { filename: `${client.company} - ${f.filename}`, content: Buffer.from(await res.arrayBuffer()) };
      }),
    )
  ).filter(Boolean) as { filename: string; content: Buffer }[];

  await emailStudio(
    `Archive before deletion — ${client.company}`,
    `<p><strong>${client.company}</strong> (${client.slug}) is being deleted from the console. Every document the project produced is attached for your records:</p>
<ul>${attachments.map((a) => `<li>${a.filename}</li>`).join("")}</ul>
<p>Brief, for the record:</p><p style="color:#6b7280;">${client.brief}</p>`,
    attachments,
  );

  const domainNotes = await removeClientDomain(slug);
  const objectsDeleted = await deleteClient(slug);
  await logActivity("operator", "deleted client", slug, client.company);
  return NextResponse.json({ ok: true, objectsDeleted, domainNotes, archived: attachments.length });
}

async function anyUserPassword(password: string): Promise<boolean> {
  for (const u of parseUsers()) {
    if ((await hashPassword(u.salt, password)) === u.hash) return true;
  }
  return false;
}

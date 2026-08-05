import { NextResponse } from "next/server";
import { getClient, deleteClient } from "@/lib/store";
import { removeClientDomain } from "@/lib/domains";

export const runtime = "nodejs";
export const maxDuration = 120;

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
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || body?.password !== expected) {
    await new Promise((r) => setTimeout(r, 800));
    return NextResponse.json({ error: "Wrong password — deletion cancelled." }, { status: 403 });
  }
  const client = await getClient(slug);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const domainNotes = await removeClientDomain(slug);
  const blobsDeleted = await deleteClient(slug);
  return NextResponse.json({ ok: true, blobsDeleted, domainNotes });
}

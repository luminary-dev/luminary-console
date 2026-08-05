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

/** Full teardown: documents, answers, record, DNS record, project domain. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const client = await getClient(slug);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const domainNotes = await removeClientDomain(slug);
  const blobsDeleted = await deleteClient(slug);
  return NextResponse.json({ ok: true, blobsDeleted, domainNotes });
}

// Operator notes on a client — private scratch space, never client-facing.
// Written by a debounced autosave, so this is deliberately cheap: no activity
// log entry (a keystroke-driven feed would drown everything else) and no
// stage side-effects. Authed by the proxy like every /api route.
import { NextResponse } from "next/server";
import { getClient, saveClient } from "@/lib/store";

export const runtime = "nodejs";

/** Generous, but bounded — the record is read on every console page load. */
const MAX_NOTES = 20_000;

async function save(req: Request, slug: string) {
  const client = await getClient(slug);
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body.notes !== "string") {
    return NextResponse.json({ error: "notes must be a string." }, { status: 400 });
  }
  if (body.notes.length > MAX_NOTES) {
    return NextResponse.json(
      { error: `Notes are capped at ${MAX_NOTES.toLocaleString("en-US")} characters.` },
      { status: 400 },
    );
  }

  const notes = body.notes;
  // Cleared notes drop the field entirely rather than storing "".
  if (notes.trim()) client.notes = notes;
  else delete client.notes;
  await saveClient(client);
  return NextResponse.json({ ok: true, at: new Date().toISOString() });
}

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  return save(req, (await params).slug);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  return save(req, (await params).slug);
}

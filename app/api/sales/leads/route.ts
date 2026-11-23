// Import the shop list. The body is the JSON from
// Products/shopfront/sales/leads-checked.json, either the bare list or
// { leads: [...] }. The list replaces the stored one whole; progress is keyed
// by shop id and is untouched, so importing a longer list never loses who has
// already been messaged.
//
// This is how the shops reach the console at all. They are not in this
// repository, which is public: see lib/sales-store.ts.
import { NextResponse } from "next/server";
import { currentOperator, logOperatorActivity } from "@/lib/operator";
import { parseLeads } from "@/lib/sales";
import { getLeadFile, saveLeads } from "@/lib/sales-store";

export const runtime = "nodejs";

/** A few hundred shops with their notes is well under this. */
const MAX_BYTES = 1_500_000;

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > MAX_BYTES) {
    return NextResponse.json({ error: "That file is too large to be a shop list." }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "That is not a JSON file." }, { status: 400 });
  }
  const list = Array.isArray(body) ? body : (body as { leads?: unknown } | null)?.leads;
  const parsed = parseLeads(list);
  if (!parsed.ok) {
    return NextResponse.json({ error: "The list was not imported.", problems: parsed.errors }, { status: 400 });
  }

  const before = (await getLeadFile())?.leads ?? [];
  const known = new Set(before.map((l) => l.id));
  const added = parsed.leads.filter((l) => !known.has(l.id)).length;
  const kept = new Set(parsed.leads.map((l) => l.id));
  const removed = before.filter((l) => !kept.has(l.id)).length;

  const by = await currentOperator();
  const file = await saveLeads(parsed.leads, by);
  await logOperatorActivity(
    "imported the shop list",
    "sales",
    `${parsed.leads.length} shops, ${added} new${removed ? `, ${removed} removed` : ""}`,
  );
  return NextResponse.json({ ok: true, total: parsed.leads.length, added, removed, importedAt: file.importedAt });
}

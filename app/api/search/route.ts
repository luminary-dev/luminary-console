// Global content search across client records — company, brief, notes,
// comments, questionnaire-derived doc data, document numbers, design titles.
// Authed by the proxy like every console API route. Small client counts, so a
// linear scan of the already-cached records is fine (no external index).
import { NextResponse } from "next/server";
import { getIndex, getClient } from "@/lib/store";
import { DOC_LABELS, type DocType, type ClientRecord } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_RESULTS = 20;

/** A short excerpt around the first match, for context. */
function snippet(haystack: string, needle: string): string {
  const i = haystack.toLowerCase().indexOf(needle);
  if (i < 0) return "";
  const start = Math.max(0, i - 30);
  const end = Math.min(haystack.length, i + needle.length + 40);
  return (start > 0 ? "…" : "") + haystack.slice(start, end).replace(/\s+/g, " ").trim() + (end < haystack.length ? "…" : "");
}

/** Return {where, snippet} for the first field of this client that matches. */
function firstMatch(c: ClientRecord, q: string): { where: string; snippet: string } | null {
  const fields: { where: string; text: string }[] = [
    { where: "brief", text: c.brief ?? "" },
    { where: "notes", text: c.notes ?? "" },
    ...(c.comments ?? []).map((m) => ({ where: `comment by ${m.by}`, text: m.text })),
    ...((Object.keys(c.docs) as DocType[]).map((t) => ({
      where: DOC_LABELS[t],
      text: `${c.docs[t]?.no ?? ""} ${JSON.stringify(c.docs[t]?.data ?? "")}`,
    }))),
    ...(c.designs ?? []).map((d) => ({ where: "design", text: d.title })),
    ...(c.billing ?? []).map((b) => ({ where: `${b.kind}`, text: `${b.no} ${JSON.stringify(b.data ?? "")}` })),
  ];
  for (const f of fields) {
    if (f.text.toLowerCase().includes(q)) return { where: f.where, snippet: snippet(f.text, q) };
  }
  return null;
}

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") || "").trim().toLowerCase();
  if (q.length < 2) return NextResponse.json({ results: [] });

  const index = await getIndex();
  const results: { slug: string; company: string; where: string; snippet: string }[] = [];
  for (const e of index) {
    if (results.length >= MAX_RESULTS) break;
    // A name/doc-no hit is handled instantly client-side; here we surface the
    // CONTENT match so the palette can show "why" this client came up.
    const c = await getClient(e.slug);
    if (!c) continue;
    const m = firstMatch(c, q);
    if (m) results.push({ slug: e.slug, company: e.company, where: m.where, snippet: m.snippet });
  }
  return NextResponse.json({ results });
}

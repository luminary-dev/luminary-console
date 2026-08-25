// Global content search across client records — company, brief, notes,
// comments, questionnaire-derived doc data, document numbers, design titles.
// Authed by the proxy like every console API route. There is no external
// index, so this is a scan; what it must not be is a scan that reads one
// record per round trip in series, or one that reads the whole store when the
// first page of hits is already full (LC-030).
import { NextResponse } from "next/server";
import { getIndex, getClients, READ_CONCURRENCY } from "@/lib/store";
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
  // One bounded batch at a time, in index order, stopping the moment the page
  // of results is full: a common term still costs a handful of reads, and a
  // rare one no longer serialises a round trip per client.
  for (let i = 0; i < index.length && results.length < MAX_RESULTS; i += READ_CONCURRENCY) {
    const batch = index.slice(i, i + READ_CONCURRENCY);
    const records = await getClients(batch.map((e) => e.slug));
    for (const [n, c] of records.entries()) {
      if (results.length >= MAX_RESULTS) break;
      if (!c) continue;
      // A name/doc-no hit is handled instantly client-side; here we surface
      // the CONTENT match so the palette can show "why" this client came up.
      const m = firstMatch(c, q);
      const e = batch[n];
      if (m && e) results.push({ slug: e.slug, company: e.company, where: m.where, snippet: m.snippet });
    }
  }
  return NextResponse.json({ results });
}

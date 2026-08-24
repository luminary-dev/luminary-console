import { NextResponse } from "next/server";
import { entryKey, markEntryRead } from "@/lib/activity";

export const runtime = "nodejs";

// "Open →" on a Recent-updates row: mark that one notification read, then
// hand the admin to the client page it points at — so an opened update
// disappears from the feed. A plain server-side redirect (the rows use a bare
// <a>, so nothing prefetches this and marks things read by accident).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const at = url.searchParams.get("at") || "";
  const target = url.searchParams.get("target") || "";
  const action = url.searchParams.get("action") || "";

  // Only ever redirect to a client page derived from the slug — the
  // destination is computed here, never taken from the query string.
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(target)) {
    return NextResponse.redirect(new URL("/", url.origin));
  }
  if (at && action) await markEntryRead(entryKey({ at, target, action }));
  return NextResponse.redirect(new URL(`/clients/${target}`, url.origin));
}

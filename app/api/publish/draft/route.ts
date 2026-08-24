import { NextResponse } from "next/server";
import { draftArticle, draftProject } from "@/lib/publish/draft";

export const runtime = "nodejs";
export const maxDuration = 300;

// Drafts content for the publish portal (article or project) — the result
// comes back to the form for human review/editing; nothing is published here.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const kind = body?.kind;
  const brief = String(body?.brief || "").trim();
  if ((kind !== "article" && kind !== "project") || brief.length < 12) {
    return NextResponse.json({ error: "Give a brief of at least a sentence." }, { status: 400 });
  }
  try {
    const draft = kind === "article" ? await draftArticle(brief) : await draftProject(brief);
    return NextResponse.json({ draft });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Drafting failed." }, { status: 502 });
  }
}

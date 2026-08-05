import { NextResponse } from "next/server";
import { getIndex, getClient } from "@/lib/store";
import { runStage1 } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  return NextResponse.json(await getIndex());
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const company = String(body.company || "").trim();
  const brief = String(body.brief || "").trim();
  let slug = String(body.slug || "").trim().toLowerCase();
  if (!company || !brief) {
    return NextResponse.json({ error: "Company name and brief are required." }, { status: 400 });
  }
  if (!slug) {
    slug = company
      .toLowerCase()
      .replace(/\([^)]*\)/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .split("-")
      .slice(0, 2)
      .join("-");
  }
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) {
    return NextResponse.json({ error: "Slug must be lowercase letters, digits and dashes." }, { status: 400 });
  }
  if (await getClient(slug)) {
    return NextResponse.json({ error: `Client "${slug}" already exists.` }, { status: 409 });
  }

  try {
    const client = await runStage1({
      slug,
      company,
      brief,
      reg: str(body.reg),
      address: str(body.address),
      email: str(body.email),
      phone: str(body.phone),
      contactName: str(body.contactName),
    });
    return NextResponse.json({ ok: true, slug: client.slug });
  } catch (e) {
    console.error("Client creation failed:", e);
    return NextResponse.json({ error: `Creation failed: ${String(e)}` }, { status: 500 });
  }
}

function str(v: unknown): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s || undefined;
}

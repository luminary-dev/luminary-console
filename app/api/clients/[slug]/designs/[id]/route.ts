// One design slot: authed raw preview (GET), publish/unpublish (POST), and
// delete (DELETE, which also tears down the subdomain). All behind the console
// session gate via proxy.ts.
import { NextResponse } from "next/server";
import { getClient, saveClient, fetchAsset, deleteAssets } from "@/lib/store";
import { removeClientDomain } from "@/lib/domains";
import type { ClientRecord, DesignEntry } from "@/lib/types";

export const runtime = "nodejs";

async function find(slug: string, id: string): Promise<{ client: ClientRecord; design: DesignEntry } | null> {
  const client = await getClient(slug);
  const design = client?.designs?.find((d) => d.id === id);
  if (!client || !design) return null;
  return { client, design };
}

/** Authed preview of the real file, whatever its status — this is how the team
 *  reviews a draft before publishing (the public subdomain shows a holding
 *  page until then). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;
  const hit = await find(slug, id);
  if (!hit) return new Response("Not found", { status: 404 });
  const res = await fetchAsset(hit.design.htmlUrl);
  if (!res.ok) return new Response("Not found", { status: 404 });
  return new Response(await res.arrayBuffer(), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow",
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;
  const hit = await find(slug, id);
  if (!hit) return NextResponse.json({ error: "No such design." }, { status: 404 });
  const { client, design } = hit;

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  if (action === "publish") design.status = "published";
  else if (action === "unpublish") design.status = "draft";
  else return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  design.updatedAt = new Date().toISOString();
  await saveClient(client);
  return NextResponse.json({ ok: true, designs: client.designs });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;
  const client = await getClient(slug);
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  const design = client.designs?.find((d) => d.id === id);
  // Idempotent: deleting an already-gone slot is a success.
  if (design) {
    await deleteAssets([design.htmlUrl]);
    try {
      await removeClientDomain(design.dslug); // Cloudflare CNAME + Vercel domain
    } catch {
      /* best effort — the record is the source of truth */
    }
    client.designs = (client.designs ?? []).filter((d) => d.id !== id);
    await saveClient(client);
  }
  return NextResponse.json({ ok: true, designs: client.designs ?? [] });
}

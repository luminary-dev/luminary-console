// Change-order log: work the client requests after the cost is finalised.
// Entries are billed as line items on the final invoice.
import { NextResponse } from "next/server";
import { getClient, saveClient } from "@/lib/store";
import { nowLabel } from "@/lib/pipeline";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const client = await getClient(slug);
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "add");

  if (action === "add") {
    const desc = typeof body.desc === "string" ? body.desc.trim().slice(0, 500) : "";
    const amount = typeof body.amount === "string" ? body.amount.trim().slice(0, 40) : "";
    if (!desc || !amount) {
      return NextResponse.json({ error: "Description and amount are both required." }, { status: 400 });
    }
    client.changeOrders = [...(client.changeOrders ?? []), { at: nowLabel(), desc, amount }];
    await saveClient(client);
    return NextResponse.json({ ok: true, changeOrders: client.changeOrders });
  }

  if (action === "remove") {
    const index = Number(body.index);
    if (!Number.isInteger(index) || !client.changeOrders?.[index]) {
      return NextResponse.json({ error: "No such change order." }, { status: 404 });
    }
    client.changeOrders.splice(index, 1);
    await saveClient(client);
    return NextResponse.json({ ok: true, changeOrders: client.changeOrders });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

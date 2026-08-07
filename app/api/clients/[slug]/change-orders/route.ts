// Change-order log: work the client requests after the cost is finalised.
// Entries are billed as line items on the final invoice.
import { NextResponse } from "next/server";
import { getClient, saveClient } from "@/lib/store";
import { nowLabel } from "@/lib/pipeline";
import { changeOrderAmount } from "@/lib/pricing";

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
    const override = typeof body.amount === "string" ? body.amount.trim().slice(0, 40) : "";
    if (!desc) {
      return NextResponse.json({ error: "Describe what changed." }, { status: 400 });
    }
    // Aftercare pricing: the first 5 change requests after launch are free,
    // then LKR 6,000 each. Default from the count of change orders already
    // logged; an explicit amount always wins (e.g. a larger quoted change).
    const priorCount = client.changeOrders?.length ?? 0;
    const fee = changeOrderAmount(priorCount);
    const amount = override || (fee === 0 ? "0" : fee.toLocaleString("en-US"));
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

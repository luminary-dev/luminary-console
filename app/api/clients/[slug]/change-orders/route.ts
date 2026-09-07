// Change-order log: work the client requests after the cost is finalised.
// Entries are billed as line items on the final invoice.
import { NextResponse } from "next/server";
import { updateClient, StoreConflictError } from "@/lib/store";
import { nowLabel } from "@/lib/pipeline";
import { changeOrderAmount } from "@/lib/pricing";

export const runtime = "nodejs";

class Reject {
  constructor(
    readonly status: number,
    readonly message: string,
  ) {}
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "add");

  try {
    if (action === "add") {
      const desc = typeof body.desc === "string" ? body.desc.trim().slice(0, 500) : "";
      const override = typeof body.amount === "string" ? body.amount.trim().slice(0, 40) : "";
      if (!desc) return NextResponse.json({ error: "Describe what changed." }, { status: 400 });

      const updated = await updateClient(slug, (client) => {
        // Aftercare pricing: the first 5 change requests after launch are free,
        // then LKR 6,000 each. The default depends on how many are ALREADY
        // logged, so it is computed against the fresh record on each retry; an
        // explicit amount always wins (e.g. a larger quoted change).
        const priorCount = client.changeOrders?.length ?? 0;
        const fee = changeOrderAmount(priorCount);
        const amount = override || (fee === 0 ? "0" : fee.toLocaleString("en-US"));
        client.changeOrders = [...(client.changeOrders ?? []), { at: nowLabel(), desc, amount }];
      });
      if (!updated) return NextResponse.json({ error: "Client not found" }, { status: 404 });
      return NextResponse.json({ ok: true, changeOrders: updated.changeOrders });
    }

    if (action === "remove") {
      const index = Number(body.index);
      const updated = await updateClient(slug, (client) => {
        if (!Number.isInteger(index) || !client.changeOrders?.[index]) {
          throw new Reject(404, "No such change order.");
        }
        client.changeOrders.splice(index, 1);
      });
      if (!updated) return NextResponse.json({ error: "Client not found" }, { status: 404 });
      return NextResponse.json({ ok: true, changeOrders: updated.changeOrders });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    if (e instanceof Reject) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof StoreConflictError) {
      return NextResponse.json(
        { error: "That client was being edited at the same time. Please retry." },
        { status: 409 },
      );
    }
    throw e;
  }
}

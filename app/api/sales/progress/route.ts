// One tap on the sales board: "I sent it", a status change, a note or a
// preview link. The rules are lib/sales.applyAction; this route only finds the
// shop, runs the rule inside a compare-and-swap, and answers with the record
// that was stored, which the board then shows.
//
// A first message carries the step the operator was looking at. If a teammate
// recorded that same first message a moment earlier, the rule refuses with a
// 409 that names them, instead of quietly counting the shop as messaged twice.
import { NextResponse } from "next/server";
import { displayName } from "@/lib/admins";
import { currentOperator, logOperatorActivity } from "@/lib/operator";
import { SalesReject, STATUS_LABEL, applyAction, parseAction } from "@/lib/sales";
import { getLeadFile, updateProgress } from "@/lib/sales-store";
import { StoreConflictError } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { id?: unknown; action?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  const action = parseAction(body?.action);
  if (!id || !action) return NextResponse.json({ error: "Unknown action." }, { status: 400 });

  const lead = (await getLeadFile())?.leads.find((l) => l.id === id);
  if (!lead) return NextResponse.json({ error: "That shop is not on the board." }, { status: 404 });

  const by = await currentOperator();
  const now = Date.now();
  try {
    const progress = await updateProgress(id, (current) => applyAction(current, action, now, by, displayName));
    // Milestones go to the audit log, where the rest of the team sees them.
    // Individual sends do not: the record itself says who sent what and when,
    // and fifteen "messaged" lines a day would bury everything else in a log
    // that keeps 500 entries.
    if (action.type === "status") {
      await logOperatorActivity(`marked a shop ${STATUS_LABEL[action.status].toLowerCase()}`, "sales", lead.name);
    }
    return NextResponse.json({ ok: true, id, progress });
  } catch (e) {
    if (e instanceof SalesReject) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof StoreConflictError) {
      return NextResponse.json(
        { error: "Someone else was updating the board at the same moment. Please try again." },
        { status: 409 },
      );
    }
    throw e;
  }
}

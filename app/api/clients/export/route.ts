// CSV export of the client list for the operator (spreadsheets / accounting).
// Authed by the proxy like every console API route. One row per client with
// the money + stage summary already computed elsewhere.
import { getIndex, getClient } from "@/lib/store";
import { clientMoney, overdueSummary } from "@/lib/money";
import { currentStage, STAGE_LABELS } from "@/lib/stage";

export const runtime = "nodejs";
export const maxDuration = 60;

const cell = (v: string | number): string => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET() {
  const index = await getIndex();
  const header = ["Company", "Doc no.", "Stage", "Status", "Email", "Outstanding (LKR)", "Overdue (LKR)", "Created"];
  const lines = [header.map(cell).join(",")];

  for (const e of index) {
    const c = await getClient(e.slug);
    if (!c) continue;
    const money = clientMoney(c);
    const od = overdueSummary(c);
    lines.push(
      [
        e.company,
        e.docNoBase,
        STAGE_LABELS[currentStage(c)],
        e.status,
        c.email ?? "",
        money.outstanding,
        od.total,
        e.createdAt.slice(0, 10),
      ]
        .map(cell)
        .join(","),
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="luminary-clients-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

// The client overview both the hub and the clients page read from.
//
// Extracted so the two cannot disagree. The dashboard shows the outstanding
// total and the client count; /clients shows the table. Both are derived from
// the same pass over the same records, and duplicating that pass would mean
// the hub could say "3 outstanding" while the table showed 2.
import { getClients, getIndex } from "@/lib/store";
import { STAGES, currentStage } from "@/lib/stage";
import { clientMoney, overdueSummary } from "@/lib/money";
import type { ClientRow } from "@/components/ClientTable";
import type { ClientStage } from "@/lib/types";

const STATUS_LABEL: Record<string, string> = {
  created: "Estimate sent",
  answers_in: "Answers in: drafting",
  drafts_ready: "Drafts ready",
};

export type ClientOverview = {
  rows: ClientRow[];
  /** How many clients exist at all, before any filter. */
  total: number;
  countsByStage: Record<ClientStage, number>;
  outstandingTotal: number;
  outstandingClients: number;
  overdueTotal: number;
  overdueClients: number;
};

/**
 * Every client, with the money and stage derived once.
 *
 * The index carries only slug, company, status, createdAt and the document
 * number. Stage, money and overdue all live inside the full record, so this
 * genuinely needs every record read: there is no smaller correct set. What is
 * not acceptable is one R2 connection per client at once, which is what
 * `Promise.all` over the index did, so `getClients` bounds the fan-out
 * (LC-030).
 */
export async function loadClientOverview(): Promise<ClientOverview> {
  const index = (await getIndex()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const records = await getClients(index.map((e) => e.slug));

  const countsByStage = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<ClientStage, number>;
  const rows: ClientRow[] = [];
  let outstandingTotal = 0;
  let outstandingClients = 0;
  let overdueTotal = 0;
  let overdueClients = 0;

  index.forEach((e, i) => {
    const rec = records[i];
    if (!rec) return;
    const stage = currentStage(rec);
    countsByStage[stage]++;

    const money = clientMoney(rec);
    if (money.outstanding > 0) {
      outstandingTotal += money.outstanding;
      outstandingClients++;
    }
    const od = overdueSummary(rec);
    if (od.count > 0) {
      overdueClients++;
      overdueTotal += od.total;
    }

    rows.push({
      slug: e.slug,
      company: e.company,
      docNoBase: e.docNoBase,
      status: e.status,
      statusLabel: STATUS_LABEL[e.status] ?? e.status,
      stage,
      createdAt: e.createdAt,
      outstanding: money.outstanding,
      overdue: od.count > 0,
    });
  });

  return {
    rows,
    total: rows.length,
    countsByStage,
    outstandingTotal,
    outstandingClients,
    overdueTotal,
    overdueClients,
  };
}

/** The unread portal-and-admin activity the hub surfaces, or an empty list. */
export async function loadUnreadActivity(limit = 8) {
  const { recentActivity, isNotifiable, getNotificationsSeenAt, getReadKeys, entryKey } = await import(
    "@/lib/activity"
  );
  const [activity, seenAt, readKeys] = await Promise.all([
    recentActivity(100),
    getNotificationsSeenAt(),
    getReadKeys(),
  ]);
  // Every action against a client, admin and portal alike, except sign-in
  // noise, minus anything already seen: globally marked read, or individually
  // dismissed by opening it. The full history stays on /activity.
  const events = activity.filter(
    (e) => isNotifiable(e) && e.at > seenAt && !readKeys.has(entryKey(e)),
  );
  return { events: events.slice(0, limit), unread: events.length };
}

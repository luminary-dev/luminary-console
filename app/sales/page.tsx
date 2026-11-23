// Sales: the send queue. One shop at a time with its message written, and a
// record of who sent what that all three operators share.
//
// Reads lib/sales-store directly (same data as /api/sales, one fewer round
// trip) and renders server-side. Authed by the proxy like every console route.
import AppTabBar from "@/components/AppTabBar";
import ConsoleTopbar from "@/components/ConsoleTopbar";
import { MAIN_ID } from "@/components/SkipLink";
import ImportShops from "@/components/sales/ImportShops";
import SalesNav from "@/components/sales/SalesNav";
import SalesQueue from "@/components/sales/SalesQueue";
import { ADMIN_NAMES } from "@/lib/admins";
import { currentOperator } from "@/lib/operator";
import { STATUS_LABEL, tally } from "@/lib/sales";
import { getSalesState } from "@/lib/sales-store";
import "@/components/sales/sales.css";

export const metadata = { title: "Sales" };
export const dynamic = "force-dynamic";

export default async function SalesPage() {
  const [state, operator] = await Promise.all([getSalesState(), currentOperator()]);
  const t = tally(state.leads, state.progress);
  // The first name a shop reads in "Hi! I'm ...". Unknown when the session
  // cannot be resolved, and then the queue asks for it.
  const me = ADMIN_NAMES[operator.toLowerCase()] ?? "";

  return (
    <div className="wrap" style={{ paddingBottom: 80 }}>
      <ConsoleTopbar current="/sales" subtitle="Sales" showNewClient={false} />
      <main id={MAIN_ID}>
        <h1 className="sr-only">Sales</h1>
        <SalesNav current="/sales" />

        {state.leads.length === 0 ? (
          <section className="card" aria-labelledby="sales-empty">
            <h3 id="sales-empty">No shops yet</h3>
            <p className="empty-note">
              The board works from a list of researched shops. Import{" "}
              <span className="mono">sales/leads-checked.json</span> from the Shopfront repository to begin. The
              list is stored in the console&apos;s bucket, not in this repository.
            </p>
            <div style={{ marginTop: 14 }}>
              <ImportShops count={0} />
            </div>
          </section>
        ) : (
          <>
            <ul className="sales-tally" aria-label="Where the shops stand">
              <li>
                <b>{t.new}</b>
                <span>{STATUS_LABEL.new}</span>
              </li>
              <li>
                <b>{t.sent}</b>
                <span>{STATUS_LABEL.sent}</span>
              </li>
              <li>
                <b>{t.replied}</b>
                <span>{STATUS_LABEL.replied}</span>
              </li>
              <li>
                <b>{t.keen}</b>
                <span>{STATUS_LABEL.keen}</span>
              </li>
              <li className="is-won">
                <b>{t.won}</b>
                <span>{STATUS_LABEL.won}</span>
              </li>
              <li>
                <b>{t.no}</b>
                <span>{STATUS_LABEL.no}</span>
              </li>
            </ul>
            <SalesQueue
              leads={state.leads}
              initialProgress={state.progress}
              operator={operator}
              me={me}
              now={Date.now()}
            />
          </>
        )}
      </main>
      <AppTabBar />
    </div>
  );
}

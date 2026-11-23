// Sales: every shop on the board, and the control that imports the list.
import AppTabBar from "@/components/AppTabBar";
import ConsoleTopbar from "@/components/ConsoleTopbar";
import RelativeTime from "@/components/RelativeTime";
import { MAIN_ID } from "@/components/SkipLink";
import ImportShops from "@/components/sales/ImportShops";
import SalesNav from "@/components/sales/SalesNav";
import ShopList from "@/components/sales/ShopList";
import { ADMIN_NAMES, displayName } from "@/lib/admins";
import { currentOperator } from "@/lib/operator";
import { getSalesState } from "@/lib/sales-store";
import { relTime } from "@/lib/time";
import "@/components/sales/sales.css";

export const metadata = { title: "Shops" };
export const dynamic = "force-dynamic";

export default async function SalesShopsPage() {
  const [state, operator] = await Promise.all([getSalesState(), currentOperator()]);
  const me = ADMIN_NAMES[operator.toLowerCase()] ?? "";
  const now = Date.now();

  return (
    <div className="wrap" style={{ paddingBottom: 80 }}>
      <ConsoleTopbar current="/sales" subtitle="Sales" showNewClient={false} />
      <main id={MAIN_ID}>
        <h1 className="sr-only">Shops</h1>
        <SalesNav current="/sales/shops" />

        {state.leads.length > 0 && (
          <ShopList leads={state.leads} initialProgress={state.progress} me={me} now={now} />
        )}

        <section className="card" aria-labelledby="sales-import">
          <h3 id="sales-import">The shop list</h3>
          <p className="empty-note">
            {state.importedAt ? (
              <>
                {state.leads.length} shops, imported{" "}
                <RelativeTime at={state.importedAt} initial={relTime(state.importedAt, now)} /> by{" "}
                {displayName(state.importedBy ?? "")}.{" "}
              </>
            ) : (
              "Nothing imported yet. "
            )}
            The list is <span className="mono">sales/leads-checked.json</span> in the Shopfront repository. Importing
            a newer one replaces the list and keeps everything already recorded against each shop.
          </p>
          <div style={{ marginTop: 14 }}>
            <ImportShops count={state.leads.length} />
          </div>
        </section>
      </main>
      <AppTabBar />
    </div>
  );
}

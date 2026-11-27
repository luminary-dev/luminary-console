// Sales: every shop on the board, and the control that imports the list.
import ConsoleShell from "@/components/shell/ConsoleShell";
import RelativeTime from "@/components/RelativeTime";
import ImportShops from "@/components/sales/ImportShops";
import ShopList from "@/components/sales/ShopList";
import { ADMIN_NAMES, displayName } from "@/lib/admins";
import { currentOperator } from "@/lib/operator";
import { getSalesState } from "@/lib/sales-store";
import { relTime } from "@/lib/time";
import "@/components/sales/sales.css";
import HowItWorks from "@/components/HowItWorks";

export const metadata = { title: "Shops" };
export const dynamic = "force-dynamic";

export default async function SalesShopsPage() {
  const [state, operator] = await Promise.all([getSalesState(), currentOperator()]);
  const me = ADMIN_NAMES[operator.toLowerCase()] ?? "";
  const now = Date.now();

  return (
    <ConsoleShell current="/sales/shops">

        {state.leads.length > 0 && (
          <ShopList leads={state.leads} initialProgress={state.progress} me={me} now={now} />
        )}

        <section className="card" aria-labelledby="sales-import">
          <h3 id="sales-import">Bring in a newer list</h3>
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
            A newer list replaces this one and keeps everything already recorded against each shop.
          </p>
          <HowItWorks label="Where the list comes from">
            <p>
              It is the file <span className="mono">sales/leads-checked.json</span> in the Shopfront
              repository.
            </p>
          </HowItWorks>
          <div style={{ marginTop: 14 }}>
            <ImportShops count={state.leads.length} />
          </div>
        </section>
    </ConsoleShell>
  );
}

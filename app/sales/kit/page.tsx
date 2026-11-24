// Sales: the social kit. Every Instagram and Facebook post in posting order,
// with shared ticks for what is already up.
//
// The posts themselves are drawn in the Shopfront repository and read from the
// kit site's manifest (lib/kit.ts); nothing here is copied into this
// repository. If the kit site cannot be read the page says why, and the rest
// of the section keeps working.
import ConsoleShell from "@/components/shell/ConsoleShell";
import KitBoard from "@/components/sales/KitBoard";
import { fetchKit, getPosted, kitOrigin } from "@/lib/kit";
import "@/components/sales/sales.css";
import HowItWorks from "@/components/HowItWorks";

export const metadata = { title: "Social kit" };
export const dynamic = "force-dynamic";

export default async function SalesKitPage() {
  const [result, posted] = await Promise.all([fetchKit(), getPosted()]);

  return (
    <ConsoleShell current="/sales/kit">
        {result.ok ? (
          <KitBoard kit={result.kit} initialPosted={posted} kitUrl={`${kitOrigin()}/`} />
        ) : (
          <section className="card" aria-labelledby="kit-missing">
            <h3 id="kit-missing">The posts could not be loaded</h3>
            <p className="empty-note">{result.reason} Try again in a minute.</p>
            <HowItWorks label="How to fix it">
              <p>
                The posts are read from <span className="mono">{kitOrigin()}/kit.json</span>. Rebuild
                and redeploy the kit from the Shopfront repository, or set{" "}
                <span className="mono">KIT_ORIGIN</span> if it has moved.
              </p>
            </HowItWorks>
          </section>
        )}
    </ConsoleShell>
  );
}

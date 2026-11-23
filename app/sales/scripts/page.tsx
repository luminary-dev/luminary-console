// Sales: what to say when a shop writes back. The first messages and the
// follow-ups are not here, because the queue writes those per shop.
import AppTabBar from "@/components/AppTabBar";
import ConsoleTopbar from "@/components/ConsoleTopbar";
import { MAIN_ID } from "@/components/SkipLink";
import CopyText from "@/components/sales/CopyText";
import SalesNav from "@/components/sales/SalesNav";
import { SCRIPTS, scriptText } from "@/lib/sales";
import "@/components/sales/sales.css";

export const metadata = { title: "Scripts" };

export default function SalesScriptsPage() {
  return (
    <div className="wrap" style={{ paddingBottom: 80 }}>
      <ConsoleTopbar current="/sales" subtitle="Sales" showNewClient={false} />
      <main id={MAIN_ID}>
        <h1 className="sr-only">Reply scripts</h1>
        <SalesNav current="/sales/scripts" />
        <section className="card" aria-labelledby="sales-scripts">
          <h3 id="sales-scripts">When they write back</h3>
          <p className="empty-note">
            Starting points, not recitals. Read the shop&apos;s message first and change the words to answer it.
          </p>
          <div style={{ marginTop: 16 }}>
            {SCRIPTS.map((s) => {
              const text = scriptText(s);
              return (
                <article className="sales-script" key={s.id} aria-labelledby={`script-${s.id}`}>
                  <h4 id={`script-${s.id}`} style={{ fontSize: 14, fontWeight: 700 }}>
                    {s.title}
                  </h4>
                  <p>{s.why}</p>
                  <div className="sales-msg">{text}</div>
                  <CopyText text={text} />
                </article>
              );
            })}
          </div>
        </section>
      </main>
      <AppTabBar />
    </div>
  );
}

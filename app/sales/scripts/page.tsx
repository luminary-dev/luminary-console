// Sales: what to say when a shop writes back. The first messages and the
// follow-ups are not here, because the queue writes those per shop.
import ConsoleShell from "@/components/shell/ConsoleShell";
import CopyText from "@/components/sales/CopyText";
import { SCRIPTS, scriptText } from "@/lib/sales";
import "@/components/sales/sales.css";

export const metadata = { title: "Scripts" };

export default function SalesScriptsPage() {
  return (
    <ConsoleShell current="/sales/scripts">
        <section className="card" aria-labelledby="sales-scripts">
          <h3 id="sales-scripts">When a shop writes back</h3>
          <p className="empty-note">
            Starting points, not scripts to recite. Read the shop&apos;s message first, then change the words to answer it.
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
    </ConsoleShell>
  );
}

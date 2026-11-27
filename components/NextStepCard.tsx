// The top of a client's page: where the project is, and what happens next.
//
// It is on every tab, so whichever part of the record you are in, the answer
// to "what now" is one glance up. The rules are lib/next-step.ts; this only
// draws them: the path a project travels with the current stage marked, whose
// turn it is, the next step in a sentence, and a button to the tab where that
// step is done (left out when you are already on it).
import Link from "next/link";
import type { ReactNode } from "react";
import HowItWorks from "@/components/HowItWorks";
import { CLIENT_TABS } from "@/components/ClientTabs";
import { WAITING_LABEL, type NextStep } from "@/lib/next-step";
import { STAGES, STAGE_LABELS } from "@/lib/stage";

export default function NextStepCard({
  slug,
  step,
  currentTab,
  children,
}: {
  slug: string;
  step: NextStep;
  /** The tab in view, so the card does not offer a button to where you are. */
  currentTab: string;
  /** The facts under the step: money, tasks, the stage control. */
  children?: ReactNode;
}) {
  const at = STAGES.indexOf(step.stage);
  const tab = step.tab ? CLIENT_TABS.find((t) => t.id === step.tab) : undefined;

  return (
    <section className="card next" aria-labelledby="next-title">
      <ol className="next-path" aria-label="The stages of a project">
        {STAGES.map((s, i) => (
          <li
            key={s}
            className={i < at ? "is-done" : i === at ? "is-now" : ""}
            {...(i === at ? { "aria-current": "step" as const } : {})}
          >
            {STAGE_LABELS[s]}
            {i < at && <span className="sr-only"> (done)</span>}
          </li>
        ))}
      </ol>

      <div className="next-row">
        <div className="next-text">
          <span className={`k next-who is-${step.waitingOn}`}>{WAITING_LABEL[step.waitingOn]}</span>
          <h3 id="next-title">{step.title}</h3>
          <p>{step.detail}</p>
        </div>
        {tab && tab.id !== currentTab && (
          <Link className="btn small" href={`/clients/${slug}?tab=${tab.id}`} scroll={false}>
            Open {tab.label}
          </Link>
        )}
      </div>

      {children ? <div className="next-facts">{children}</div> : null}

      <HowItWorks label="How the stages move">
        <p>
          The stage moves forward by itself. Publishing the quotation makes it Quoted. The client
          accepting it makes it Accepted. Recording the first payment makes it Development.
          Publishing the receipt for the last payment makes it Delivered, then Warranty for 30
          days, then Closed. Change the stage by hand only to correct it.
        </p>
      </HowItWorks>
    </section>
  );
}

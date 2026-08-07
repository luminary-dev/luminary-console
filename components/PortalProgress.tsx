// Where the project has got to, for the client's eyes: the lifecycle stage
// (lib/stage) mapped onto the six things a client actually experiences.
// Server component — pure markup, no JS.
import type { ClientStage } from "@/lib/types";
import { stageRank } from "@/lib/stage";

type Step = {
  /** Desktop label. */
  label: string;
  /** Narrow-screen label — six columns share ~300px at 390px, so the long
   *  words get a short form rather than breaking mid-word. */
  short: string;
  /** The lifecycle stage this step is "in progress" for. */
  stage: ClientStage;
  /** One line of plain English for the step the client is on now. */
  now: string;
};

const STEPS: Step[] = [
  {
    label: "Questionnaire",
    short: "Questions",
    stage: "lead",
    now: "Tell us about your business in the questionnaire — everything else is built from it.",
  },
  {
    label: "Quotation",
    short: "Quotation",
    stage: "quoted",
    now: "Your quotation is ready to read and accept.",
  },
  {
    label: "Advance",
    short: "Advance",
    stage: "accepted",
    now: "The advance invoice is next — the build starts once it's settled.",
  },
  {
    label: "Development",
    short: "Build",
    stage: "development",
    now: "We're building. You'll hear from us at each milestone.",
  },
  {
    label: "Delivery",
    short: "Delivery",
    stage: "delivered",
    now: "Delivery — final invoice, handover and go-live.",
  },
  {
    label: "Warranty",
    short: "Warranty",
    stage: "warranty",
    now: "You're in the 30-day warranty window — anything that misbehaves, just tell us.",
  },
];

export default function PortalProgress({ stage }: { stage: ClientStage }) {
  // "closed" sits past the last step, so everything reads as done.
  const rank = stageRank(stage);
  const currentIndex = stage === "closed" ? STEPS.length : STEPS.findIndex((s) => s.stage === stage);
  const caption =
    stage === "closed"
      ? "This project is complete — the documents below stay available."
      : (STEPS[currentIndex] ?? STEPS[0]).now;

  return (
    <div className="card">
      <h3>Project progress</h3>
      <ol className="pstep-track" aria-label="Project progress">
        {STEPS.map((s, i) => {
          // Namespaced state classes: a bare "done" would inherit the
          // questionnaire thank-you screen's .done rule (60px of padding).
          const state = i < currentIndex ? "is-done" : i === currentIndex ? "is-now" : "is-todo";
          return (
            <li className={`pstep ${state}`} key={s.label} aria-current={state === "is-now" ? "step" : undefined}>
              <span className="pstep-dot" aria-hidden="true">
                {state === "is-done" ? "✓" : i + 1}
              </span>
              <span className="pstep-label">
                <span className="pstep-long">{s.label}</span>
                <span className="pstep-short">{s.short}</span>
              </span>
              <span className="pstep-sr">
                {state === "is-done" ? " — done" : state === "is-now" ? " — in progress" : " — to come"}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="pstep-caption">{caption}</p>
      {rank < stageRank("delivered") && (
        <p className="pstep-note">
          Questions at any point — reply to any of our emails or write to{" "}
          <a href="mailto:support@luminary-dev.xyz">support@luminary-dev.xyz</a>.
        </p>
      )}
    </div>
  );
}

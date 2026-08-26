// CI checks for one pull request, plus the one-line tally the inbox row uses.
//
// The tally and the list are in the same file on purpose: the row and the
// detail page must never disagree about how many checks are failing, and the
// cheapest way to guarantee that is one function.
import {
  isFailingConclusion,
  isPendingCheck,
  type CheckSummary,
} from "@/lib/github/entities";
import { StatusIcon, type StatusTone } from "./MergeVerdict";

export type CheckTally = {
  passed: number;
  failing: number;
  pending: number;
  /** neutral, skipped, cancelled and stale: reported, but not a failure. */
  other: number;
  total: number;
};

export function tallyChecks(checks: CheckSummary[]): CheckTally {
  const tally: CheckTally = { passed: 0, failing: 0, pending: 0, other: 0, total: checks.length };
  for (const c of checks) {
    if (isFailingConclusion(c.conclusion)) tally.failing++;
    else if (isPendingCheck(c)) tally.pending++;
    else if (c.conclusion === "success") tally.passed++;
    else tally.other++;
  }
  return tally;
}

/** Words, not a colour and not a bare number. Leads with the bad news. */
export function checksLabel(tally: CheckTally): string {
  if (tally.total === 0) return "No checks";
  const parts: string[] = [];
  if (tally.failing) parts.push(`${tally.failing} failing`);
  if (tally.pending) parts.push(`${tally.pending} running`);
  if (tally.passed) parts.push(`${tally.passed} passed`);
  if (tally.other) parts.push(`${tally.other} skipped`);
  return parts.join(", ");
}

export function checksTone(tally: CheckTally): StatusTone {
  if (tally.failing) return "bad";
  if (tally.pending) return "warn";
  if (tally.passed) return "ok";
  return "idle";
}

/** One check's state as a word plus the tone that word is drawn in. */
export function checkState(check: CheckSummary): { label: string; tone: StatusTone } {
  if (isFailingConclusion(check.conclusion)) {
    // "timed out" and "action required" are not the same fault as "failure",
    // and an operator chasing a red check needs to know which it was.
    const label = (check.conclusion ?? "failure").replace(/_/g, " ");
    return { label, tone: "bad" };
  }
  if (isPendingCheck(check)) {
    return { label: check.status === "queued" ? "queued" : "running", tone: "warn" };
  }
  if (check.conclusion === "success") return { label: "passed", tone: "ok" };
  return { label: (check.conclusion ?? check.status).replace(/_/g, " "), tone: "idle" };
}

/** Wall-clock duration of a completed check, or null while it is still going. */
function duration(check: CheckSummary): string | null {
  if (!check.startedAt || !check.completedAt) return null;
  const ms = Date.parse(check.completedAt) - Date.parse(check.startedAt);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

/** The compact tally, for a list row. */
export function ChecksSummary({ checks }: { checks: CheckSummary[] }) {
  const tally = tallyChecks(checks);
  const tone = checksTone(tally);
  return (
    <span className={`gh-status is-${tone}`}>
      <StatusIcon tone={tone} />
      <span>
        <span className="sr-only">Checks: </span>
        {checksLabel(tally)}
      </span>
    </span>
  );
}

export default function CheckList({ checks }: { checks: CheckSummary[] }) {
  if (checks.length === 0) {
    return (
      <p className="gh-note">
        No checks reported for this commit. Either the workflows have not started yet, or this
        repository runs none on pull requests.
      </p>
    );
  }

  // Failures first: the reason anyone opens this list is to find the red one.
  const order = { bad: 0, warn: 1, idle: 2, ok: 3 } as const;
  const sorted = [...checks].sort(
    (a, b) => order[checkState(a).tone] - order[checkState(b).tone] || a.name.localeCompare(b.name),
  );

  return (
    <ul className="gh-lines">
      {sorted.map((check) => {
        const state = checkState(check);
        const took = duration(check);
        return (
          <li className="gh-line" key={`${check.id}-${check.name}`}>
            <span className={`gh-status is-${state.tone}`}>
              <StatusIcon tone={state.tone} />
              <span>{state.label}</span>
            </span>
            <span className="gh-line-name">
              {check.url ? (
                <a href={check.url} target="_blank" rel="noopener noreferrer">
                  {check.name}
                </a>
              ) : (
                check.name
              )}
              {check.required ? <span className="gh-tag" style={{ marginLeft: 8 }}>required</span> : null}
            </span>
            {took ? <span className="gh-line-meta">{took}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

// Security alerts from all three GitHub scanners in one list.
//
// Ordering is the whole design here. listAllAlerts already puts open alerts
// before closed ones and sorts by severity, but severity is the wrong first
// key for secret scanning: a leaked credential has no CVSS score and is
// already in someone else's hands, so it outranks a critical dependency
// advisory that still needs an exploit written for it. sortAlerts below puts
// open secret scanning alerts at the top unconditionally.
import type { AlertEntity } from "@/lib/github/entities";
import { StatusIcon, type StatusTone } from "./MergeVerdict";

const KIND_LABELS: Record<AlertEntity["kind"], string> = {
  secret_scanning: "Secret scanning",
  code_scanning: "Code scanning",
  dependabot: "Dependabot",
};

/** Lower sorts first. */
const severityRank = (severity?: string): number =>
  ({ critical: 0, high: 1, medium: 2, moderate: 2, low: 3, warning: 3, note: 4 })[
    (severity ?? "").toLowerCase()
  ] ?? 5;

const isOpen = (alert: AlertEntity): boolean => alert.state.toLowerCase() === "open";

/** True for an alert that is both open and a leaked secret. */
export const isLeakedSecret = (alert: AlertEntity): boolean =>
  alert.kind === "secret_scanning" && isOpen(alert);

export function sortAlerts(alerts: AlertEntity[]): AlertEntity[] {
  return [...alerts].sort((a, b) => {
    // A closed alert is history; it never outranks anything still open.
    if (isOpen(a) !== isOpen(b)) return isOpen(a) ? -1 : 1;
    if (isLeakedSecret(a) !== isLeakedSecret(b)) return isLeakedSecret(a) ? -1 : 1;
    const bySeverity = severityRank(a.severity) - severityRank(b.severity);
    if (bySeverity !== 0) return bySeverity;
    // Stable, readable tail-break so two renders of the same data agree.
    return a.repo.localeCompare(b.repo) || a.number - b.number;
  });
}

export function alertTone(alert: AlertEntity): StatusTone {
  if (!isOpen(alert)) return "idle";
  if (alert.kind === "secret_scanning") return "bad";
  switch (severityRank(alert.severity)) {
    case 0:
    case 1:
      return "bad";
    case 2:
      return "warn";
    default:
      return "idle";
  }
}

/** Words for the severity, since secret scanning alerts carry none and a blank
 *  cell would read as "no severity" rather than "not applicable". */
export function severityLabel(alert: AlertEntity): string {
  if (alert.severity) return alert.severity.toLowerCase();
  return alert.kind === "secret_scanning" ? "leaked secret" : "unrated";
}

export function alertCounts(alerts: AlertEntity[]): {
  open: number;
  secrets: number;
  byKind: Record<AlertEntity["kind"], number>;
} {
  const byKind: Record<AlertEntity["kind"], number> = {
    secret_scanning: 0,
    code_scanning: 0,
    dependabot: 0,
  };
  let open = 0;
  let secrets = 0;
  for (const alert of alerts) {
    if (!isOpen(alert)) continue;
    open += 1;
    byKind[alert.kind] += 1;
    if (alert.kind === "secret_scanning") secrets += 1;
  }
  return { open, secrets, byKind };
}

export default function AlertList({ alerts }: { alerts: AlertEntity[] }) {
  const sorted = sortAlerts(alerts);
  const counts = alertCounts(alerts);

  return (
    <>
      {counts.secrets > 0 ? (
        <div className="gh-urgent">
          <StatusIcon tone="bad" />
          <div>
            <p className="gh-urgent-title">
              {counts.secrets} leaked {counts.secrets === 1 ? "secret" : "secrets"} to revoke now
            </p>
            <p className="gh-urgent-body">
              Secret scanning found {counts.secrets === 1 ? "a credential" : "credentials"}{" "}
              committed to a repository. Assume {counts.secrets === 1 ? "it is" : "they are"}{" "}
              already compromised: revoke and rotate first, then remove the commit. Do this before
              anything else on this page, including any critical dependency advisory below.
            </p>
          </div>
        </div>
      ) : null}

      <p className="gh-note">
        {counts.open === 0
          ? "Nothing open across Dependabot, code scanning and secret scanning."
          : `${counts.open} open: ${counts.byKind.secret_scanning} secret scanning, ${counts.byKind.code_scanning} code scanning, ${counts.byKind.dependabot} Dependabot.`}{" "}
        Open alerts sort above closed ones, leaked secrets above everything else, then by severity.
      </p>

      <div className="gh-scroll">
        <table className="gh-table">
          <caption className="sr-only">
            Security alerts across every repository, leaked secrets first, then open alerts by
            severity, then closed alerts.
          </caption>
          <thead>
            <tr>
              <th scope="col">Alert</th>
              <th scope="col">Source</th>
              <th scope="col">Severity</th>
              <th scope="col">State</th>
              <th scope="col">Repository</th>
              <th scope="col">Opened</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((alert) => {
              const tone = alertTone(alert);
              const leaked = isLeakedSecret(alert);
              return (
                <tr className="gh-row" key={`${alert.repo}-${alert.kind}-${alert.number}`}>
                  <th scope="row">
                    {alert.url ? (
                      <a
                        className="gh-row-link"
                        href={alert.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {alert.title}
                      </a>
                    ) : (
                      <span className="gh-row-link">{alert.title}</span>
                    )}
                    {leaked ? (
                      <span className="gh-sub-text">
                        Revoke and rotate this credential, then remove it from history.
                      </span>
                    ) : null}
                  </th>
                  <td>{KIND_LABELS[alert.kind]}</td>
                  <td>
                    <span className={`gh-sev is-${tone}`}>
                      <StatusIcon tone={tone} />
                      <span>
                        <span className="sr-only">Severity: </span>
                        {severityLabel(alert)}
                      </span>
                    </span>
                  </td>
                  <td>
                    <span className={`gh-status is-${isOpen(alert) ? tone : "idle"}`}>
                      <StatusIcon tone={isOpen(alert) ? tone : "idle"} />
                      <span>{alert.state.toLowerCase()}</span>
                    </span>
                  </td>
                  <td className="gh-cell-mono">{alert.repo}</td>
                  <td className="gh-cell-mono">{alert.createdAt?.slice(0, 10) ?? "unknown"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Table-shaped placeholder, hidden from assistive technology; the live region
 *  on the page announces the load. */
export function AlertListSkeleton() {
  return (
    <div className="gh-scroll">
      <table className="gh-table">
        <caption className="sr-only">Security alerts, loading.</caption>
        <thead>
          <tr>
            <th scope="col">Alert</th>
            <th scope="col">Source</th>
            <th scope="col">Severity</th>
            <th scope="col">State</th>
            <th scope="col">Repository</th>
            <th scope="col">Opened</th>
          </tr>
        </thead>
        <tbody>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <tr className="gh-row" key={i} aria-hidden="true">
              <th scope="row">
                <span className="gh-skel gh-skel--wide" />
                <span className="gh-skel gh-skel--half" />
              </th>
              <td><span className="gh-skel gh-skel--wide" /></td>
              <td><span className="gh-skel gh-skel--wide" /></td>
              <td><span className="gh-skel gh-skel--wide" /></td>
              <td><span className="gh-skel gh-skel--wide" /></td>
              <td><span className="gh-skel gh-skel--wide" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

"use client";

// Repository health, one row per repository.
//
// Every number here is derived from the stored projection lists rather than
// read from GitHub, so this screen costs no API budget and cannot disagree
// with the pull request inbox about how many pull requests are open.
//
// Sorting is client side because the whole projection is already here: a round
// trip to reorder eight rows would be slower and would lose keyboard position.
import { useMemo, useState } from "react";
import { StatusIcon, type StatusTone } from "./MergeVerdict";
import { shortAge } from "./PrRow";
// The row derivation lives in lib, not here: /github/repos is a SERVER
// component and computes these rows before handing them down, and a pure
// function exported from a "use client" module cannot be called from the
// server. React refuses at runtime, the error boundary catches it, and the
// route still answers 200 while rendering nothing.
import {
  repoHealthRows,
  passRateLabel,
  type RepoHealthRow,
} from "@/lib/github/repo-health";

export { repoHealthRows, passRateLabel };
export type { RepoHealthRow };

/** Thresholds are deliberately blunt: this is a "look here first" signal, not
 *  a service level objective. */
export function passRateTone(rate: number | null): StatusTone {
  if (rate === null) return "idle";
  if (rate >= 0.9) return "ok";
  if (rate >= 0.7) return "warn";
  return "bad";
}

export function alertsTone(open: number): StatusTone {
  return open === 0 ? "ok" : "bad";
}

export function alertsLabel(open: number): string {
  return open === 0 ? "none open" : `${open} open`;
}

type SortKey = "repo" | "prs" | "ci" | "alerts" | "pushed";

const SORT_LABELS: Record<SortKey, string> = {
  repo: "Repository",
  prs: "Open PRs",
  ci: "CI pass rate",
  alerts: "Open alerts",
  pushed: "Last push",
};

export default function RepoHealth({
  rows,
  now,
}: {
  rows: RepoHealthRow[];
  /** One clock for the whole render, taken on the server, so an age is
   *  identical before and after hydration. */
  now: number;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "repo", dir: 1 });

  const shown = useMemo(() => {
    const dir = sort.dir;
    return [...rows].sort((a, b) => {
      switch (sort.key) {
        case "prs":
          return (a.openPrs - b.openPrs) * dir;
        case "ci":
          // Unknown sorts last whichever way the column points: a repository
          // with no runs is not the healthiest and not the sickest.
          if (a.passRate === null || b.passRate === null) {
            return (a.passRate === null ? 1 : 0) - (b.passRate === null ? 1 : 0);
          }
          return (a.passRate - b.passRate) * dir;
        case "alerts":
          return (a.openAlerts - b.openAlerts) * dir;
        case "pushed":
          return (a.repo.pushedAt ?? "").localeCompare(b.repo.pushedAt ?? "") * dir;
        default:
          return a.repo.fullName.localeCompare(b.repo.fullName) * dir;
      }
    });
  }, [rows, sort]);

  const ariaSort = (key: SortKey): "ascending" | "descending" | "none" =>
    sort.key !== key ? "none" : sort.dir === 1 ? "ascending" : "descending";

  const toggleSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === "repo" ? 1 : -1 },
    );

  const sortHead = (key: SortKey, numeric = false) => (
    <th scope="col" aria-sort={ariaSort(key)} className={numeric ? "gh-num" : undefined}>
      <button type="button" className="th-sort" onClick={() => toggleSort(key)}>
        {SORT_LABELS[key]}
        <span className="th-arrow" aria-hidden="true">
          {sort.key === key ? (sort.dir === 1 ? "↑" : "↓") : ""}
        </span>
      </button>
    </th>
  );

  return (
    <>
      <p className="sr-only" aria-live="polite">
        {`${shown.length} repositories, sorted by ${SORT_LABELS[sort.key].toLowerCase()} ${ariaSort(
          sort.key,
        )}.`}
      </p>
      <div className="gh-scroll">
        <table className="gh-table">
          <caption className="sr-only">
            Repositories with open pull request count, CI pass rate, open security alerts, default
            branch and last push.
          </caption>
          <thead>
            <tr>
              {sortHead("repo")}
              {sortHead("prs", true)}
              {sortHead("ci")}
              {sortHead("alerts")}
              <th scope="col">Default branch</th>
              {sortHead("pushed")}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <RepoRow key={row.repo.fullName} row={row} now={now} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function RepoRow({ row, now }: { row: RepoHealthRow; now: number }) {
  const { repo } = row;
  const ciTone = passRateTone(row.passRate);
  const alertTone = alertsTone(row.openAlerts);

  return (
    <tr className="gh-row">
      <th scope="row">
        <a
          className="gh-row-link"
          href={repo.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {repo.fullName}
        </a>
        <span className="gh-row-meta">
          <span>{repo.private ? "private" : "public"}</span>
          {repo.archived ? <span>archived</span> : null}
          <span>{repo.language ?? "language unknown"}</span>
          <span>{repo.license ?? "no licence"}</span>
        </span>
      </th>
      <td className="gh-num">{row.openPrs}</td>
      <td>
        <span className={`gh-status is-${ciTone}`}>
          <StatusIcon tone={ciTone} />
          <span>
            <span className="sr-only">CI pass rate: </span>
            {passRateLabel(row)}
          </span>
        </span>
      </td>
      <td>
        <span className={`gh-status is-${alertTone}`}>
          <StatusIcon tone={alertTone} />
          <span>
            <span className="sr-only">Security alerts: </span>
            {alertsLabel(row.openAlerts)}
          </span>
        </span>
      </td>
      <td className="gh-cell-mono">{repo.defaultBranch}</td>
      <td className="gh-cell-mono">
        {repo.pushedAt ? (
          <span title={repo.pushedAt}>{shortAge(repo.pushedAt, now)} ago</span>
        ) : (
          "never"
        )}
      </td>
    </tr>
  );
}

/** A row-shaped placeholder so the table does not jump when data lands. It is
 *  hidden from assistive technology; the live region announces the load. */
export function RepoHealthSkeleton() {
  return (
    <div className="gh-scroll">
      <table className="gh-table">
        <caption className="sr-only">Repositories, loading.</caption>
        <thead>
          <tr>
            <th scope="col">Repository</th>
            <th scope="col">Open PRs</th>
            <th scope="col">CI pass rate</th>
            <th scope="col">Open alerts</th>
            <th scope="col">Default branch</th>
            <th scope="col">Last push</th>
          </tr>
        </thead>
        <tbody>
          {[0, 1, 2, 3, 4].map((i) => (
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

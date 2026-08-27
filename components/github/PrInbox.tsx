"use client";

// The pull request inbox: saved views, sorting, and keyboard-first movement.
//
// The server hands over the whole projection already read; filtering and
// sorting happen here so switching views costs nothing and never loses the
// keyboard position to a round trip.
//
// Keyboard map: j / ArrowDown next, k / ArrowUp previous, Enter opens the
// selected pull request, Escape clears the selection. Selection IS focus (a
// roving tabindex over the row links), not a class, so a screen reader lands
// on the same row the eye does.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PullRequestEntity } from "@/lib/github/entities";
import { VIEWS, applyView, viewById, viewCounts } from "@/lib/github/views";
import PrRow, { prHref } from "./PrRow";

/** Where the operator's GitHub login is remembered. The console authenticates
 *  by email and has no GitHub identity of its own, so "needs my review" and
 *  "my pull requests" would otherwise be permanently empty. */
const LOGIN_KEY = "luminary-github-login";

type SortKey = "pr" | "author" | "updated";

const SORT_LABELS: Record<SortKey, string> = {
  pr: "Pull request",
  author: "Author",
  updated: "Updated",
};

export type PrInboxProps = {
  prs: PullRequestEntity[];
  /** Counts for every saved view, computed server-side in one pass. */
  counts: Record<string, number>;
  /** One clock for the whole render, so server and client agree on every age. */
  now: number;
  /** Whether any GitHub credential exists, which decides what an empty inbox
   *  means: nothing to show, or nothing ever synced. */
  githubConfigured: boolean;
  /** The signed-in operator's GitHub login, resolved server-side from
   *  GITHUB_OPERATORS. Empty when this operator is not mapped. Used as the
   *  starting value so the personal views work without being asked. */
  operatorLogin?: string;
};

export default function PrInbox({
  prs,
  counts,
  now,
  githubConfigured,
  operatorLogin = "",
}: PrInboxProps) {
  const router = useRouter();
  const loginId = useId();
  const [viewId, setViewId] = useState("everything");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "updated", dir: -1 });
  const [selected, setSelected] = useState<number | null>(null);
  // Seeded from the server so the first paint already knows who this is, and
  // so server and client render the same thing. A value saved in this browser
  // wins, but only after mount: reading localStorage during render would make
  // the two sides disagree and trip hydration.
  const [viewerLogin, setViewerLogin] = useState(operatorLogin);
  const rowRefs = useRef<(HTMLAnchorElement | null)[]>([]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LOGIN_KEY);
      // Functional update so this does not close over viewerLogin: the effect
      // runs once on mount and must not be re-run when the value changes.
      // `saved !== null` rather than a truthiness test, so an operator who
      // deliberately clears the field keeps it cleared instead of having the
      // server value reappear on every reload.
      if (saved !== null) setViewerLogin((current) => (saved === current ? current : saved));
    } catch {
      // Storage can be unavailable (private mode); the personal views simply
      // stay empty, which they already explain.
    }
  }, []);

  const ctx = useMemo(
    () => (viewerLogin.trim() ? { viewerLogin: viewerLogin.trim(), now } : { now }),
    [viewerLogin, now],
  );

  // The server counted without knowing who is looking, so the personal views
  // are recounted here once a login is known, and only then.
  const liveCounts = useMemo(
    () => (ctx.viewerLogin ? viewCounts(prs, ctx) : counts),
    [prs, ctx, counts],
  );

  const shown = useMemo(() => {
    const filtered = applyView(prs, viewId, ctx);
    const dir = sort.dir;
    return [...filtered].sort((a, b) => {
      if (sort.key === "pr") {
        return (a.repo.localeCompare(b.repo) || a.number - b.number) * dir;
      }
      if (sort.key === "author") {
        return (a.author?.login ?? "").localeCompare(b.author?.login ?? "") * dir;
      }
      return a.updatedAt.localeCompare(b.updatedAt) * dir;
    });
  }, [prs, viewId, ctx, sort]);

  const focusRow = useCallback((index: number) => {
    const el = rowRefs.current[index];
    if (!el) return;
    el.focus();
    // jsdom has no layout, so this is absent there; guard rather than crash.
    if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest" });
  }, []);

  const move = useCallback(
    (delta: number) => {
      if (shown.length === 0) return;
      const next =
        selected === null ? 0 : Math.min(shown.length - 1, Math.max(0, selected + delta));
      setSelected(next);
      focusRow(next);
    },
    [shown.length, selected, focusRow],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Never steal a shortcut the browser or the command palette owns.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable) {
        return;
      }

      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        move(1);
        return;
      }
      if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        move(-1);
        return;
      }
      if (event.key === "Escape") {
        setSelected(null);
        (document.activeElement as HTMLElement | null)?.blur();
        return;
      }
      if (event.key === "Enter") {
        // Enter belongs to whatever is focused unless that is a row: a chip
        // or a sort header must still activate normally.
        const inRow = !!target?.closest("[data-gh-row]");
        if (!inRow && target && target !== document.body) return;
        const pr = selected === null ? null : shown[selected];
        if (!pr) return;
        // Preventing the default stops the browser following the link too, so
        // there is exactly one navigation.
        event.preventDefault();
        router.push(prHref(pr));
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [move, selected, shown, router]);

  const changeView = (next: string) => {
    setViewId(next);
    // The row that was selected is probably not in the new view, and keeping
    // an index would silently point at a different pull request.
    setSelected(null);
  };

  const changeLogin = (value: string) => {
    setViewerLogin(value);
    setSelected(null);
    try {
      window.localStorage.setItem(LOGIN_KEY, value.trim());
    } catch {
      // Not persisting is survivable; the session still filters correctly.
    }
  };

  const toggleSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: (s.dir * -1) as 1 | -1 }
        : { key, dir: key === "updated" ? -1 : 1 },
    );

  const ariaSort = (key: SortKey): "ascending" | "descending" | "none" =>
    sort.key !== key ? "none" : sort.dir === 1 ? "ascending" : "descending";

  const sortHead = (key: SortKey) => (
    <th scope="col" aria-sort={ariaSort(key)}>
      <button type="button" className="th-sort" onClick={() => toggleSort(key)}>
        {SORT_LABELS[key]}
        <span className="th-arrow" aria-hidden="true">
          {sort.key === key ? (sort.dir === 1 ? "↑" : "↓") : ""}
        </span>
      </button>
    </th>
  );

  if (prs.length === 0) {
    return (
      <section className="card" aria-labelledby="gh-empty-title">
        <h2 className="gh-card-title" id="gh-empty-title">
          No pull requests stored yet
        </h2>
        <p className="gh-note">
          This screen reads the stored projection, not GitHub directly, so it stays empty until
          something has been synced into it.
        </p>
        {githubConfigured ? (
          <p className="gh-note">
            A GitHub credential is configured, so the likely cause is that no backfill has run and
            no webhook has arrived yet. Run the backfill, then reload. If pull requests are open on
            GitHub and this stays empty, check that the App is installed on the org and that its
            webhook deliveries are succeeding.
          </p>
        ) : (
          <p className="gh-note">
            No GitHub credential is configured, so nothing can sync. Set the GitHub App
            (<code>GITHUB_APP_ID</code> and <code>GITHUB_APP_PRIVATE_KEY</code>) or, as a stopgap,{" "}
            <code>GH_TOKEN</code>, then run the backfill. See <b>docs/GITHUB-APP.md</b> for the
            install steps.
          </p>
        )}
      </section>
    );
  }

  const view = viewById(viewId);
  const selectedPr = selected === null ? null : shown[selected];

  return (
    <>
      <section className="card" aria-labelledby="gh-views-title">
        <h2 className="gh-card-title" id="gh-views-title">
          Saved views
        </h2>
        <div className="gh-chips" role="group" aria-label="Filter by saved view">
          {VIEWS.map((v) => {
            const personalWithoutViewer = v.personal && !ctx.viewerLogin;
            return (
              <button
                key={v.id}
                type="button"
                className="gh-chip"
                aria-pressed={viewId === v.id}
                disabled={personalWithoutViewer}
                title={personalWithoutViewer ? "Add your GitHub login to use this view" : v.description}
                onClick={() => changeView(v.id)}
              >
                {v.label}
                <span className="gh-chip-n">{liveCounts[v.id] ?? 0}</span>
              </button>
            );
          })}
        </div>
        {view ? <p className="gh-view-note">{view.description}</p> : null}

        <div className="gh-toolbar">
          <div className="gh-login">
            <label className="k" htmlFor={loginId}>
              Your GitHub login
            </label>
            <input
              id={loginId}
              className="q-line"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder={operatorLogin || "octocat"}
              value={viewerLogin}
              onChange={(e) => changeLogin(e.target.value)}
            />
            <span className="gh-view-note" style={{ marginTop: 2 }}>
              {operatorLogin
                ? "Taken from your operator account. Change it here if you use a different GitHub login; the override is kept in this browser only."
                : "Kept in this browser only. The two personal views need it to know who you are. Setting GITHUB_OPERATORS fills this in automatically."}
            </span>
          </div>
        </div>

        <p className="gh-keys">
          <kbd>j</kbd> and <kbd>k</kbd> move down and up, <kbd>Enter</kbd> opens the selected pull
          request, <kbd>Esc</kbd> clears the selection.
        </p>
      </section>

      <section className="card" aria-labelledby="gh-list-title">
        <h2 className="gh-card-title" id="gh-list-title">
          {view ? view.label : "Pull requests"}
        </h2>

        {/* Filtering, sorting and selection are silent otherwise: the rows just
            change under the cursor. */}
        <p className="sr-only" aria-live="polite">
          {`${shown.length} of ${prs.length} pull requests shown, sorted by ${SORT_LABELS[
            sort.key
          ].toLowerCase()} ${ariaSort(sort.key)}.`}
          {selectedPr ? ` Selected ${selectedPr.repo} number ${selectedPr.number}.` : ""}
        </p>

        {shown.length === 0 ? (
          <p className="gh-note">
            No pull requests match this view. Switch to{" "}
            <button type="button" className="gh-linkbtn" onClick={() => changeView("everything")}>
              every open pull request
            </button>{" "}
            to see the rest.
          </p>
        ) : (
          <div className="gh-scroll">
            <table className="gh-table">
              <caption className="sr-only">
                Open pull requests, one row each, with merge readiness, review state and check
                state.
              </caption>
              <thead>
                <tr>
                  {sortHead("pr")}
                  {sortHead("author")}
                  <th scope="col">Merge readiness</th>
                  <th scope="col">Reviews</th>
                  <th scope="col">Checks</th>
                  {sortHead("updated")}
                </tr>
              </thead>
              <tbody>
                {shown.map((pr, i) => (
                  <PrRow
                    key={`${pr.repo}#${pr.number}`}
                    pr={pr}
                    now={now}
                    index={i}
                    selected={selected === i}
                    tabbable={selected === null ? i === 0 : selected === i}
                    onSelect={setSelected}
                    linkRef={(el) => {
                      rowRefs.current[i] = el;
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

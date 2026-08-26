// Releases, with their notes rendered as PLAIN TEXT.
//
// A release body is third-party input: anyone who can push a tag can write it,
// and on a public repository that is anyone who can open a pull request that
// gets merged. Rendering it as markdown means rendering it as HTML, which
// means an injection surface on an internal console that is authenticated as
// an operator. So the body goes into a pre-wrap block as text. React escapes
// it, no markdown is parsed, no URL is auto-linked, and the reader loses only
// the formatting.
import { Suspense } from "react";
import Link from "next/link";
import AppTabBar from "@/components/AppTabBar";
import SignOut from "@/components/SignOut";
import ThemeToggle from "@/components/ThemeToggle";
import { MAIN_ID } from "@/components/SkipLink";
import { githubConfigured } from "@/lib/github/config";
import type { ReleaseEntity } from "@/lib/github/entities";
import { listAllReleases } from "@/lib/github/projection";
import GithubNav, { GithubEmpty, GithubError } from "@/components/github/GithubNav";
import { StatusIcon, type StatusTone } from "@/components/github/MergeVerdict";
import "@/components/github/github.css";
import "@/components/github/github-views.css";

export const metadata = { title: "Releases" };
export const dynamic = "force-dynamic";

/** Draft and prerelease are not faults, so they read as quiet rather than red,
 *  but they are never left implicit: a prerelease that looks like a release is
 *  how the wrong tag gets deployed. */
/** Repository full names carry a slash, which is not usable in an id that
 *  aria-labelledby has to resolve. */
const notesId = (release: ReleaseEntity): string =>
  `rel-notes-${release.repo.replace(/[^A-Za-z0-9_-]/g, "-")}-${release.id}`;

export function releaseState(release: ReleaseEntity): { label: string; tone: StatusTone } {
  if (release.draft) return { label: "draft, not published", tone: "idle" };
  if (release.prerelease) return { label: "prerelease", tone: "warn" };
  return { label: "published", tone: "ok" };
}

export default function ReleasesPage() {
  return (
    <main className="wrap gh-page" id={MAIN_ID} tabIndex={-1}>
      <div className="topbar">
        <div className="brand">
          Luminary<span>.</span>
          <small>Releases</small>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <ThemeToggle />
          <SignOut />
          <Link className="btn ghost small app-hide" href="/">
            <span aria-hidden="true">← </span>Dashboard
          </Link>
        </div>
      </div>

      <GithubNav current="/github/releases" />

      <div className="gh-head">
        <div>
          <h1 className="gh-h1">Releases</h1>
          <p className="gh-lede">
            Every release across the organisation, newest first, with its tag, date, author and
            notes. Notes are shown as plain text, never as rendered markup.
          </p>
        </div>
      </div>

      <Suspense fallback={<ReleasesSkeleton />}>
        <ReleasesData />
      </Suspense>

      <AppTabBar />
    </main>
  );
}

async function ReleasesData() {
  let releases;
  try {
    releases = await listAllReleases();
  } catch (error) {
    return (
      <GithubError
        title="Could not read the release projection"
        detail={error instanceof Error ? error.message : String(error)}
      >
        Release notes are only ever read from the store, so a store failure leaves nothing to fall
        back on. The releases themselves are unaffected; only this view of them is.
      </GithubError>
    );
  }

  if (releases.length === 0) {
    return (
      <GithubEmpty title="No releases stored yet" configured={githubConfigured()}>
        This screen lists releases the projection has stored. Run a backfill to pull existing tags
        and releases in, then reload. A repository that ships from branches without cutting GitHub
        releases will stay absent here, which is expected rather than a fault.
      </GithubEmpty>
    );
  }

  const drafts = releases.filter((r) => r.draft).length;

  return (
    <>
      <section className="card" aria-labelledby="rel-list">
        <h2 className="gh-card-title" id="rel-list">
          {releases.length} {releases.length === 1 ? "release" : "releases"}
        </h2>
        <p className="gh-note">
          Newest first. {drafts > 0
            ? `${drafts} of these ${drafts === 1 ? "is a draft and is" : "are drafts and are"} not visible to anyone outside the organisation.`
            : "None of these are drafts."}{" "}
          Release notes below are printed exactly as written, as text: no markdown is rendered and
          no link in them is made clickable, because anyone who can push a tag can write that text.
        </p>

        {releases.map((release) => {
          const state = releaseState(release);
          return (
            <article className="gh-release" key={`${release.repo}-${release.id}`}>
              <h3 className="gh-release-head">
                <span className="gh-release-tag">{release.tagName}</span>
                {release.name && release.name !== release.tagName ? (
                  <span className="gh-release-name">{release.name}</span>
                ) : null}
                <span className={`gh-status is-${state.tone}`}>
                  <StatusIcon tone={state.tone} />
                  <span>
                    <span className="sr-only">Release state: </span>
                    {state.label}
                  </span>
                </span>
              </h3>
              <p className="gh-release-meta">
                {release.repo} &middot;{" "}
                {release.publishedAt
                  ? `${release.publishedAt.slice(0, 10)} by ${release.author?.login ?? "an unknown account"}`
                  : `never published, drafted by ${release.author?.login ?? "an unknown account"}`}
              </p>
              {release.body && release.body.trim() ? (
                <>
                  <p className="sr-only" id={notesId(release)}>
                    Release notes for {release.tagName}, shown as plain text.
                  </p>
                  {/* Long notes scroll inside this block, and a region that
                      scrolls has to be reachable by keyboard or its content is
                      unreadable without a mouse (WCAG 2.1.1). The lint rule
                      below only allows tabindex on a tabpanel, which does not
                      cover the scrollable-region case. */}
                  {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
                  <div tabIndex={0} className="gh-release-body" role="region" aria-labelledby={notesId(release)}>
                    {release.body}
                  </div>
                </>
              ) : (
                <p className="gh-note">No notes were written for this release.</p>
              )}
              {release.url ? (
                <p className="gh-links">
                  <a href={release.url} target="_blank" rel="noopener noreferrer">
                    Open {release.tagName} on GitHub
                  </a>
                </p>
              ) : null}
            </article>
          );
        })}
      </section>
    </>
  );
}

function ReleasesSkeleton() {
  return (
    <section className="card" aria-labelledby="rel-loading">
      <h2 className="gh-card-title" id="rel-loading">
        Loading releases
      </h2>
      <p className="sr-only" aria-live="polite">
        Reading the stored releases.
      </p>
      {[0, 1, 2].map((i) => (
        <div className="gh-release" key={i} aria-hidden="true">
          <span className="gh-skel gh-skel--half" />
          <span className="gh-skel gh-skel--half" />
          <span className="gh-skel gh-skel--wide" />
          <span className="gh-skel gh-skel--wide" />
        </div>
      ))}
    </section>
  );
}

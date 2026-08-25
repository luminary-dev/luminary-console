// The GitHub console's section navigation, plus the empty and error furniture
// every section screen shares.
//
// The nav lives here rather than in a layout because each of these screens is
// its own route with its own data read: a layout would have to know which one
// is current anyway, and passing the current href in makes the marking a
// server-rendered fact rather than a hydration-time one.
//
// The empty and error blocks are here too because their WORDING is the shared
// part. Each screen supplies the sentence that names its own first action; the
// paragraph that distinguishes "GitHub is not configured" from "nothing has
// been synced yet" is identical everywhere and must stay that way, since an
// operator who learns it once should not have to re-read it per screen.
import Link from "next/link";
import type { ReactNode } from "react";

export type GithubSection = { href: string; label: string };

export const GITHUB_SECTIONS: GithubSection[] = [
  { href: "/github", label: "Pull requests" },
  { href: "/github/repos", label: "Repositories" },
  { href: "/github/ci", label: "CI" },
  { href: "/github/deployments", label: "Deployments" },
  { href: "/github/releases", label: "Releases" },
  { href: "/github/security", label: "Security" },
  { href: "/github/insights", label: "Insights" },
  { href: "/github/activity", label: "Activity" },
];

/** `current` is the section's own href, so exactly one link is marked. */
export default function GithubNav({ current }: { current: string }) {
  return (
    <nav className="gh-nav" aria-label="GitHub console sections">
      <ul className="gh-nav-list">
        {GITHUB_SECTIONS.map((section) => (
          <li key={section.href}>
            <Link
              className="gh-nav-link"
              href={section.href}
              aria-current={section.href === current ? "page" : undefined}
            >
              {section.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Nothing stored yet.
 *
 * Two causes, and they need different actions, so they are never collapsed
 * into one "no data" shrug: with no credential nothing can ever sync, and with
 * a credential the answer is almost always that no backfill has run.
 */
export function GithubEmpty({
  title,
  configured,
  children,
}: {
  title: string;
  configured: boolean;
  /** What this screen shows, and the first action to take on it. */
  children: ReactNode;
}) {
  return (
    <section className="card" aria-labelledby="gh-empty-title">
      <h2 className="gh-card-title" id="gh-empty-title">
        {title}
      </h2>
      <p className="gh-note">{children}</p>
      {configured ? (
        <p className="gh-note">
          A GitHub credential is configured, so nothing is stopping a sync. The likely cause is
          that no backfill has run and no webhook has arrived yet. Run the backfill, then reload.
          If it stays empty after that, check that the App is installed on the organisation and
          that its webhook deliveries are succeeding.
        </p>
      ) : (
        <p className="gh-note">
          No GitHub credential is configured, so nothing can sync and this screen cannot fill.
          Set the GitHub App (<code>GITHUB_APP_ID</code> and <code>GITHUB_APP_PRIVATE_KEY</code>)
          or, as a stopgap, <code>GH_TOKEN</code>, then run the backfill. See{" "}
          <b>docs/GITHUB-APP.md</b> for the install steps.
        </p>
      )}
    </section>
  );
}

/**
 * The store did not answer.
 *
 * Nothing is shown rather than something stale being passed off as current,
 * and the copy says what failed and what to do about it.
 */
export function GithubError({
  title,
  detail,
  children,
}: {
  title: string;
  /** The underlying message, shown verbatim so it can be searched for. */
  detail: string;
  /** What to do next, specific to this screen. */
  children?: ReactNode;
}) {
  return (
    <section className="card" aria-labelledby="gh-error-title">
      <h2 className="gh-card-title" id="gh-error-title">
        {title}
      </h2>
      <p className="gh-note">
        The object store did not answer, so this screen is showing nothing rather than passing off
        stale data as current. Reload to retry. If it keeps failing, the object store is the place
        to look: the console reads every GitHub entity from it.
      </p>
      {children ? <p className="gh-note">{children}</p> : null}
      <p className="form-error">{detail}</p>
    </section>
  );
}

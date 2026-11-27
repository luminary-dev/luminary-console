// The empty and error furniture every Code screen shares.
//
// (This file used to hold the section's own row of tabs as well. The side
// menu lists those screens now, from lib/menu.ts, so the tabs are gone.)
//
// The WORDING is the shared part. Each screen supplies the sentence that names
// its own first action; the line that tells "GitHub is not connected" from
// "nothing has been brought in yet" is identical everywhere and must stay that
// way, since someone who learns it once should not have to re-read it per
// screen. The plain sentence is on the card; the setup detail an engineer
// needs is folded under it.
import type { ReactNode } from "react";
import HowItWorks from "@/components/HowItWorks";

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
      <p className="gh-note">
        {configured
          ? "Nothing has been brought in from GitHub yet. That usually sorts itself out after the first sync."
          : "The console is not connected to GitHub yet, so there is nothing to show here."}
      </p>
      <HowItWorks label={configured ? "If it stays empty" : "How to connect it"}>
        {configured ? (
          <p>
            A GitHub credential is configured, so nothing is stopping a sync. The likely cause is
            that no backfill has run and no webhook has arrived yet. Run the backfill, then reload.
            If it stays empty after that, check that the App is installed on the organisation and
            that its webhook deliveries are succeeding.
          </p>
        ) : (
          <p>
            No GitHub credential is configured, so nothing can sync and this screen cannot fill.
            Set the GitHub App (<code>GITHUB_APP_ID</code> and <code>GITHUB_APP_PRIVATE_KEY</code>)
            or, as a stopgap, <code>GH_TOKEN</code>, then run the backfill. See{" "}
            <b>docs/GITHUB-APP.md</b> for the install steps.
          </p>
        )}
      </HowItWorks>
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
        This could not be read just now, so nothing is shown instead of something out of date.
        Reload the page to try again.
      </p>
      <HowItWorks label="If it keeps failing">
        <p>
          The object store did not answer. The console reads everything about GitHub from it, so
          that is the place to look.
        </p>
      </HowItWorks>
      {children ? <p className="gh-note">{children}</p> : null}
      <p className="form-error" role="alert">{detail}</p>
    </section>
  );
}

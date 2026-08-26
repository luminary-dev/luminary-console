// Security alerts from Dependabot, code scanning and secret scanning, in one
// list.
//
// Three scanners, one screen, because an operator does not think in terms of
// which GitHub feature found a problem. The ordering is the opinion: leaked
// secrets first, then open alerts by severity, then everything closed. A
// leaked credential has no severity score and does not need one, since it is
// already in someone else's hands while a critical advisory still needs an
// exploit written for it.
import { Suspense } from "react";
import Link from "next/link";
import AppTabBar from "@/components/AppTabBar";
import SignOut from "@/components/SignOut";
import ThemeToggle from "@/components/ThemeToggle";
import { MAIN_ID } from "@/components/SkipLink";
import { githubConfigured } from "@/lib/github/config";
import { listAllAlerts } from "@/lib/github/projection";
import GithubNav, { GithubEmpty, GithubError } from "@/components/github/GithubNav";
import AlertList, { AlertListSkeleton, alertCounts } from "@/components/github/AlertList";
import "@/components/github/github.css";
import "@/components/github/github-views.css";

export const metadata = { title: "Security" };
export const dynamic = "force-dynamic";

export default function SecurityPage() {
  return (
    <main className="wrap gh-page" id={MAIN_ID} tabIndex={-1}>
      <div className="topbar">
        <div className="brand">
          Luminary<span>.</span>
          <small>Security</small>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <ThemeToggle />
          <SignOut />
          <Link className="btn ghost small app-hide" href="/">
            <span aria-hidden="true">← </span>Dashboard
          </Link>
        </div>
      </div>

      <GithubNav current="/github/security" />

      <div className="gh-head">
        <div>
          <h1 className="gh-h1">Security</h1>
          <p className="gh-lede">
            Dependabot, code scanning and secret scanning alerts across every repository, ordered
            by what needs doing first. A leaked secret outranks everything else on this page.
          </p>
        </div>
      </div>

      <Suspense fallback={<SecuritySkeleton />}>
        <SecurityData />
      </Suspense>

      <AppTabBar />
    </main>
  );
}

async function SecurityData() {
  let alerts;
  try {
    alerts = await listAllAlerts();
  } catch (error) {
    return (
      <GithubError
        title="Could not read the security alert projection"
        detail={error instanceof Error ? error.message : String(error)}
      >
        Treat an empty security screen as unknown, never as clear. Until this recovers, check the
        Security tab on GitHub directly for anything open.
      </GithubError>
    );
  }

  if (alerts.length === 0) {
    return (
      <GithubEmpty title="No security alerts stored yet" configured={githubConfigured()}>
        An empty list here means nothing has been synced, which is not the same as nothing being
        wrong. Run a backfill to pull existing alerts in, then reload. Also check that Dependabot,
        code scanning and secret scanning are switched on for the organisation: a scanner that is
        off reports nothing and looks identical to a scanner that found nothing.
      </GithubEmpty>
    );
  }

  const counts = alertCounts(alerts);

  return (
    <>
      <section className="card" aria-labelledby="sec-summary">
        <h2 className="gh-card-title" id="sec-summary">
          Open alerts
        </h2>
        <dl className="gh-metrics">
          <div>
            <dt className="gh-metric-k">Secret scanning</dt>
            <dd className="gh-metric-v">{counts.byKind.secret_scanning}</dd>
            <p className="gh-metric-note">
              Credentials committed to a repository. Revoke and rotate before anything else.
            </p>
          </div>
          <div>
            <dt className="gh-metric-k">Code scanning</dt>
            <dd className="gh-metric-v">{counts.byKind.code_scanning}</dd>
            <p className="gh-metric-note">Faults found in code we wrote.</p>
          </div>
          <div>
            <dt className="gh-metric-k">Dependabot</dt>
            <dd className="gh-metric-v">{counts.byKind.dependabot}</dd>
            <p className="gh-metric-note">Advisories against dependencies we pulled in.</p>
          </div>
          <div>
            <dt className="gh-metric-k">Total open</dt>
            <dd className="gh-metric-v">{counts.open}</dd>
            <p className="gh-metric-note">
              Out of {alerts.length} stored, including {alerts.length - counts.open} already closed.
            </p>
          </div>
        </dl>
      </section>

      <section className="card" aria-labelledby="sec-list">
        <h2 className="gh-card-title" id="sec-list">
          Every alert
        </h2>
        <AlertList alerts={alerts} />
      </section>
    </>
  );
}

function SecuritySkeleton() {
  return (
    <section className="card" aria-labelledby="sec-loading">
      <h2 className="gh-card-title" id="sec-loading">
        Loading security alerts
      </h2>
      <p className="sr-only" aria-live="polite">
        Reading the stored Dependabot, code scanning and secret scanning alerts.
      </p>
      <AlertListSkeleton />
    </section>
  );
}

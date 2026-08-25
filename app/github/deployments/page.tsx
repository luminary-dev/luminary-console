// Deployments: what version is where, put there by whom, and when.
//
// Grouped by environment because that is the question people actually arrive
// with ("what is on production right now"), and a single chronological list
// answers it only by making the reader filter in their head. Within each
// environment the newest deployment is first, and each group leads with the
// version currently live there.
//
// A failed deployment is the one thing on this screen that must never be
// missed, so it is called out above the fold, again on its environment, and
// again on its own row.
import { Suspense } from "react";
import Link from "next/link";
import AppTabBar from "@/components/AppTabBar";
import SignOut from "@/components/SignOut";
import ThemeToggle from "@/components/ThemeToggle";
import { MAIN_ID } from "@/components/SkipLink";
import { githubConfigured } from "@/lib/github/config";
import type { DeploymentEntity } from "@/lib/github/entities";
import { listAllDeployments } from "@/lib/github/projection";
import GithubNav, { GithubEmpty, GithubError } from "@/components/github/GithubNav";
import { StatusIcon, type StatusTone } from "@/components/github/MergeVerdict";
import { shortAge } from "@/components/github/PrRow";
import "@/components/github/github.css";
import "@/components/github/github-views.css";

export const metadata = { title: "Deployments" };
export const dynamic = "force-dynamic";

/** GitHub's deployment states, said in words with a tone attached. "inactive"
 *  is not a failure: it means a newer deployment superseded this one. */
export function deploymentState(state: string): { label: string; tone: StatusTone } {
  switch (state.toLowerCase()) {
    case "success":
      return { label: "succeeded", tone: "ok" };
    case "failure":
      return { label: "failed", tone: "bad" };
    case "error":
      return { label: "errored", tone: "bad" };
    case "pending":
      return { label: "pending", tone: "warn" };
    case "queued":
      return { label: "queued", tone: "warn" };
    case "in_progress":
      return { label: "in progress", tone: "warn" };
    case "inactive":
      return { label: "superseded", tone: "idle" };
    default:
      return { label: state.toLowerCase().replace(/_/g, " ") || "unknown", tone: "idle" };
  }
}

/** Environment names come from a payload and can contain spaces or slashes,
 *  which would produce an id that aria-labelledby cannot resolve. */
const envId = (environment: string): string =>
  `dep-env-${environment.replace(/[^A-Za-z0-9_-]/g, "-")}`;

export const deploymentFailed = (d: DeploymentEntity): boolean =>
  ["failure", "error"].includes(d.state.toLowerCase());

export type EnvironmentGroup = {
  environment: string;
  deployments: DeploymentEntity[];
  /** The newest deployment that actually succeeded: what is live. */
  live: DeploymentEntity | undefined;
  /** The newest deployment of any state, which is what failed if one did. */
  latest: DeploymentEntity;
};

export function groupByEnvironment(deployments: DeploymentEntity[]): EnvironmentGroup[] {
  const byEnv = new Map<string, DeploymentEntity[]>();
  for (const d of deployments) {
    const list = byEnv.get(d.environment) ?? [];
    list.push(d);
    byEnv.set(d.environment, list);
  }

  const groups: EnvironmentGroup[] = [];
  for (const [environment, list] of byEnv) {
    const sorted = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const latest = sorted[0];
    // An environment key only exists because a deployment was pushed under
    // it, so the list is never empty. The guard keeps that fact checkable.
    if (!latest) continue;
    groups.push({
      environment,
      deployments: sorted,
      live: sorted.find((d) => d.state.toLowerCase() === "success"),
      latest,
    });
  }
  // Most recently touched environment first: the one someone just deployed
  // to is the one they are here to look at.
  return groups.sort((a, b) => b.latest.createdAt.localeCompare(a.latest.createdAt));
}

export default function DeploymentsPage() {
  return (
    <main className="wrap gh-page" id={MAIN_ID} tabIndex={-1}>
      <div className="topbar">
        <div className="brand">
          Luminary<span>.</span>
          <small>Deployments</small>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <ThemeToggle />
          <SignOut />
          <Link className="btn ghost small app-hide" href="/">
            <span aria-hidden="true">← </span>Dashboard
          </Link>
        </div>
      </div>

      <GithubNav current="/github/deployments" />

      <div className="gh-head">
        <div>
          <h1 className="gh-h1">Deployments</h1>
          <p className="gh-lede">
            What version is on each environment, who put it there and when. Grouped by
            environment, newest first, with anything that failed called out.
          </p>
        </div>
      </div>

      <Suspense fallback={<DeploymentsSkeleton />}>
        <DeploymentsData />
      </Suspense>

      <AppTabBar />
    </main>
  );
}

async function DeploymentsData() {
  let deployments;
  try {
    deployments = await listAllDeployments();
  } catch (error) {
    return (
      <GithubError
        title="Could not read the deployment projection"
        detail={error instanceof Error ? error.message : String(error)}
      >
        Nothing on this screen is a live read, so a store failure means the console cannot say what
        is deployed. Check the environment on GitHub directly until this recovers.
      </GithubError>
    );
  }

  if (deployments.length === 0) {
    return (
      <GithubEmpty title="No deployments stored yet" configured={githubConfigured()}>
        This screen reads deployments the projection has stored. Run a backfill to pull recent
        deployments in, then reload. If deployments happen outside GitHub Deployments, they will
        never appear here: the console only sees what the deployments API reports.
      </GithubEmpty>
    );
  }

  const groups = groupByEnvironment(deployments);
  const broken = groups.filter((g) => deploymentFailed(g.latest));
  // Named when exactly one environment is broken, so the headline can say
  // which one instead of counting to one.
  const onlyBroken = broken.length === 1 ? broken[0] : undefined;
  const now = Date.now();

  return (
    <>
      {broken.length > 0 ? (
        <section className="card" aria-labelledby="dep-broken">
          <h2 className="gh-card-title" id="dep-broken">
            Failed deployments
          </h2>
          <div className="gh-urgent">
            <StatusIcon tone="bad" />
            <div>
              <p className="gh-urgent-title">
                {onlyBroken
                  ? `The last deployment to ${onlyBroken.environment} failed`
                  : `The last deployment to ${broken.length} environments failed`}
              </p>
              <p className="gh-urgent-body">
                {broken
                  .map(
                    (g) =>
                      `${g.environment} is running ${
                        g.live ? `${g.live.ref} (${g.live.sha.slice(0, 7)})` : "an unknown version"
                      } because the newer deployment of ${g.latest.ref} did not land`,
                  )
                  .join("; ")}
                . Read the deployment log, fix the cause, and redeploy. Until then the environment
                is behind what its branch says.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <section className="card" aria-labelledby="dep-now">
        <h2 className="gh-card-title" id="dep-now">
          What is where
        </h2>
        <p className="gh-note">
          The newest successful deployment on each environment. A failed deployment does not change
          what is live, so this line and the history below can disagree, and that disagreement is
          the point.
        </p>
        <div className="gh-scroll">
          <table className="gh-table gh-table--tight">
            <caption className="sr-only">
              Each environment with the version currently live on it, who deployed it and when.
            </caption>
            <thead>
              <tr>
                <th scope="col">Environment</th>
                <th scope="col">Version live</th>
                <th scope="col">Deployed by</th>
                <th scope="col">Last deployment</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                const state = deploymentState(group.latest.state);
                return (
                  <tr className="gh-row" key={group.environment}>
                    <th scope="row">
                      <span className="gh-env-name">{group.environment}</span>
                      <span className="gh-sub">{group.latest.repo}</span>
                    </th>
                    <td className="gh-cell-mono">
                      {group.live
                        ? `${group.live.ref} ${group.live.sha.slice(0, 7)}`
                        : "nothing has succeeded here"}
                    </td>
                    <td className="gh-cell-mono">{group.live?.creator?.login ?? "unknown"}</td>
                    <td>
                      <span className={`gh-status is-${state.tone}`}>
                        <StatusIcon tone={state.tone} />
                        <span>
                          <span className="sr-only">Last deployment: </span>
                          {state.label}, {shortAge(group.latest.createdAt, now)} ago
                        </span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {groups.map((group) => (
        <section
          className="card"
          key={group.environment}
          aria-labelledby={envId(group.environment)}
        >
          <h2 className="gh-card-title" id={envId(group.environment)}>
            {group.environment}
          </h2>
          <p className="gh-env-now">
            {group.live ? (
              <>
                Live: <b>{group.live.ref}</b> at <b>{group.live.sha.slice(0, 7)}</b>, deployed by{" "}
                {group.live.creator?.login ?? "an unknown account"}{" "}
                {shortAge(group.live.createdAt, now)} ago.
              </>
            ) : (
              "No deployment to this environment has succeeded yet."
            )}
          </p>
          {deploymentFailed(group.latest) ? (
            <div className="gh-urgent">
              <StatusIcon tone="bad" />
              <div>
                <p className="gh-urgent-title">
                  The most recent deployment here {deploymentState(group.latest.state).label}
                </p>
                <p className="gh-urgent-body">
                  {group.latest.ref} at {group.latest.sha.slice(0, 7)}, attempted by{" "}
                  {group.latest.creator?.login ?? "an unknown account"}{" "}
                  {shortAge(group.latest.createdAt, now)} ago. Read the log, fix the cause, and
                  redeploy.
                </p>
              </div>
            </div>
          ) : null}
          <div className="gh-scroll">
            <table className="gh-table gh-table--tight">
              <caption className="sr-only">
                Deployment history for {group.environment}, newest first.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Version</th>
                  <th scope="col">State</th>
                  <th scope="col">By</th>
                  <th scope="col">Repository</th>
                  <th scope="col">When</th>
                </tr>
              </thead>
              <tbody>
                {group.deployments.map((deployment) => {
                  const state = deploymentState(deployment.state);
                  return (
                    <tr className="gh-row" key={`${deployment.repo}-${deployment.id}`}>
                      <th scope="row">
                        <span className="gh-line-name">{deployment.ref}</span>
                        <span className="gh-sub">{deployment.sha.slice(0, 7)}</span>
                      </th>
                      <td>
                        <span className={`gh-status is-${state.tone}`}>
                          <StatusIcon tone={state.tone} />
                          <span>
                            <span className="sr-only">State: </span>
                            {state.label}
                          </span>
                        </span>
                      </td>
                      <td className="gh-cell-mono">{deployment.creator?.login ?? "unknown"}</td>
                      <td className="gh-cell-mono">{deployment.repo}</td>
                      <td className="gh-cell-mono">
                        <span title={deployment.createdAt}>
                          {shortAge(deployment.createdAt, now)} ago
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {group.live?.environmentUrl ? (
            <p className="gh-links">
              <a href={group.live.environmentUrl} target="_blank" rel="noopener noreferrer">
                Open {group.environment}
              </a>
            </p>
          ) : null}
        </section>
      ))}
    </>
  );
}

function DeploymentsSkeleton() {
  return (
    <section className="card" aria-labelledby="dep-loading">
      <h2 className="gh-card-title" id="dep-loading">
        Loading deployments
      </h2>
      <p className="sr-only" aria-live="polite">
        Reading the stored deployments.
      </p>
      <div className="gh-scroll">
        <table className="gh-table gh-table--tight">
          <caption className="sr-only">Deployments, loading.</caption>
          <thead>
            <tr>
              <th scope="col">Environment</th>
              <th scope="col">Version live</th>
              <th scope="col">Deployed by</th>
              <th scope="col">Last deployment</th>
            </tr>
          </thead>
          <tbody>
            {[0, 1, 2, 3].map((i) => (
              <tr className="gh-row" key={i} aria-hidden="true">
                <th scope="row">
                  <span className="gh-skel gh-skel--wide" />
                  <span className="gh-skel gh-skel--half" />
                </th>
                <td><span className="gh-skel gh-skel--wide" /></td>
                <td><span className="gh-skel gh-skel--wide" /></td>
                <td><span className="gh-skel gh-skel--wide" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

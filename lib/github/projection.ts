// Persistence for projected GitHub entities.
//
// Same storage discipline as the webhook inbox: one object per entity, keyed
// by a natural id, never a shared array. A pull_request event and a check_run
// event for the SAME pull request arrive within milliseconds of each other,
// and a shared array would make those two writers race (LC-002). Per-entity
// keys make concurrent writers touch different objects.
//
// A per-repo index of PR numbers is maintained separately so list views do
// not have to enumerate the bucket. That index IS a shared array, so it is
// written with an idempotent merge (add-if-absent) rather than a replace, and
// a lost update there costs a list-view refresh, never a lost entity.
import { readState, writeState, clearState, listState } from "@/lib/store";
import { logger } from "@/lib/logger";
import type {
  AlertEntity,
  DeploymentEntity,
  PullRequestEntity,
  ReleaseEntity,
  RepoEntity,
  WorkflowRunEntity,
} from "./entities";

/** Repository full names contain exactly one slash and are otherwise safe
 *  path characters, but they arrive from a payload, so they are normalised
 *  into a single key segment rather than trusted as a path. */
export function repoKey(fullName: string): string {
  const safe = fullName.replace(/[^A-Za-z0-9_.-]/g, "_");
  if (!safe || safe.length > 120) throw new Error(`Unusable repository name: ${fullName}`);
  return safe;
}

const prPath = (repo: string, number: number) =>
  `github/prs/${repoKey(repo)}/${Math.trunc(number)}.json`;
const repoPath = (repo: string) => `github/repos/${repoKey(repo)}.json`;
const runPath = (repo: string, id: number) =>
  `github/runs/${repoKey(repo)}/${Math.trunc(id)}.json`;
const deploymentPath = (repo: string, id: number) =>
  `github/deployments/${repoKey(repo)}/${Math.trunc(id)}.json`;
const releasePath = (repo: string, id: number) =>
  `github/releases/${repoKey(repo)}/${Math.trunc(id)}.json`;
const alertPath = (repo: string, kind: string, n: number) =>
  `github/alerts/${repoKey(repo)}/${kind}-${Math.trunc(n)}.json`;

// ——— pull requests ———

export const getPullRequest = (repo: string, number: number): Promise<PullRequestEntity | null> =>
  readState<PullRequestEntity>(prPath(repo, number));

/**
 * Write a pull request projection.
 *
 * Out-of-order webhook delivery is normal (a redelivered `closed` can arrive
 * before the `opened` it superseded). Rather than trusting arrival order, we
 * refuse to overwrite a newer projection with an older one, comparing GitHub's
 * own `updated_at`. Handlers additionally reconcile against the API, so the
 * stored copy converges even when a delivery is lost entirely.
 */
export async function putPullRequest(pr: PullRequestEntity): Promise<{ written: boolean }> {
  const path = prPath(pr.repo, pr.number);
  const existing = await readState<PullRequestEntity>(path).catch(() => null);
  if (existing) {
    const incoming = Date.parse(pr.updatedAt);
    const current = Date.parse(existing.updatedAt);
    if (Number.isFinite(incoming) && Number.isFinite(current) && incoming < current) {
      return { written: false };
    }
  }
  await writeState(path, pr);
  return { written: true };
}

export const deletePullRequest = (repo: string, number: number): Promise<void> =>
  clearState(prPath(repo, number));

/** Every stored PR for one repo. */
export async function listPullRequests(repo: string, max = 500): Promise<PullRequestEntity[]> {
  const keys = await listState(`github/prs/${repoKey(repo)}/`);
  const records = await Promise.all(
    keys.slice(0, max).map((k) => readStateByKey<PullRequestEntity>(k)),
  );
  return records.filter((r): r is PullRequestEntity => r !== null);
}

/** Every stored PR across every known repo. The PR inbox is org-wide, so
 *  this is the hot path for the main screen; it reads per-repo in parallel. */
export async function listAllPullRequests(max = 1000): Promise<PullRequestEntity[]> {
  const all = await listAllUnder<PullRequestEntity>("github/prs/");
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, max);
}

// ——— repositories ———

export const getRepo = (repo: string): Promise<RepoEntity | null> =>
  readState<RepoEntity>(repoPath(repo));

export async function putRepo(repo: RepoEntity): Promise<void> {
  await writeState(repoPath(repo.fullName), repo);
}

export const deleteRepo = (repo: string): Promise<void> => clearState(repoPath(repo));

export async function listRepos(): Promise<RepoEntity[]> {
  const keys = await listState("github/repos/");
  const records = await Promise.all(keys.map((k) => readStateByKey<RepoEntity>(k)));
  return records
    .filter((r): r is RepoEntity => r !== null)
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

// ——— workflow runs ———

export async function putWorkflowRun(run: WorkflowRunEntity): Promise<void> {
  await writeState(runPath(run.repo, run.id), run);
}

export async function listWorkflowRuns(repo: string, max = 200): Promise<WorkflowRunEntity[]> {
  const keys = await listState(`github/runs/${repoKey(repo)}/`);
  const records = await Promise.all(
    keys.slice(0, max).map((k) => readStateByKey<WorkflowRunEntity>(k)),
  );
  return records
    .filter((r): r is WorkflowRunEntity => r !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listAllWorkflowRuns(max = 500): Promise<WorkflowRunEntity[]> {
  const all = await listAllUnder<WorkflowRunEntity>("github/runs/");
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, max);
}

// ——— deployments, releases, alerts ———

export async function putDeployment(d: DeploymentEntity): Promise<void> {
  await writeState(deploymentPath(d.repo, d.id), d);
}

export async function listDeployments(repo: string, max = 100): Promise<DeploymentEntity[]> {
  const keys = await listState(`github/deployments/${repoKey(repo)}/`);
  const records = await Promise.all(
    keys.slice(0, max).map((k) => readStateByKey<DeploymentEntity>(k)),
  );
  return records
    .filter((r): r is DeploymentEntity => r !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listAllDeployments(max = 300): Promise<DeploymentEntity[]> {
  const all = await listAllUnder<DeploymentEntity>("github/deployments/");
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, max);
}

export async function putRelease(r: ReleaseEntity): Promise<void> {
  await writeState(releasePath(r.repo, r.id), r);
}

export async function listReleases(repo: string, max = 100): Promise<ReleaseEntity[]> {
  const keys = await listState(`github/releases/${repoKey(repo)}/`);
  const records = await Promise.all(
    keys.slice(0, max).map((k) => readStateByKey<ReleaseEntity>(k)),
  );
  return records
    .filter((r): r is ReleaseEntity => r !== null)
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
}

export async function listAllReleases(max = 200): Promise<ReleaseEntity[]> {
  const all = await listAllUnder<ReleaseEntity>("github/releases/");
  return all
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
    .slice(0, max);
}

export async function putAlert(a: AlertEntity): Promise<void> {
  await writeState(alertPath(a.repo, a.kind, a.number), a);
}

export async function listAlerts(repo: string, max = 200): Promise<AlertEntity[]> {
  const keys = await listState(`github/alerts/${repoKey(repo)}/`);
  const records = await Promise.all(
    keys.slice(0, max).map((k) => readStateByKey<AlertEntity>(k)),
  );
  return records.filter((r): r is AlertEntity => r !== null);
}

export async function listAllAlerts(max = 500): Promise<AlertEntity[]> {
  const all = await listAllUnder<AlertEntity>("github/alerts/");
  // Open alerts first, then by severity, so the security view leads with what
  // matters rather than with whatever sorted first alphabetically.
  const severityRank = (s?: string): number =>
    ({ critical: 0, high: 1, medium: 2, moderate: 2, low: 3, warning: 3, note: 4 })[
      (s ?? "").toLowerCase()
    ] ?? 5;
  return all
    .sort((a, b) => {
      if ((a.state === "open") !== (b.state === "open")) return a.state === "open" ? -1 : 1;
      return severityRank(a.severity) - severityRank(b.severity);
    })
    .slice(0, max);
}

/**
 * The most objects one org-wide listing will read. A ceiling exists so a
 * bucket that has grown far past expectations cannot turn one page render
 * into tens of thousands of parallel reads. Hitting it is logged rather than
 * absorbed silently: a list that quietly stops being complete is exactly the
 * kind of console that lies about the state of the world.
 */
const MAX_OBJECTS_SCANNED = 5000;

/**
 * Every stored entity under `prefix`, across every repository.
 *
 * This enumerates the stored objects directly. It used to walk `listRepos()`
 * and list each repository in turn, which made an entity invisible whenever
 * its repository projection happened to be missing. That was reachable, not
 * theoretical: the `pull_request` handler writes the pull request but never
 * writes a repository, and the `push` handler deliberately only updates a
 * repository projection that already exists. A repository that emitted pull
 * request events without ever emitting a `repository` event, an
 * `installation_repositories.added`, or a sync therefore accumulated pull
 * requests that no list view would ever show.
 *
 * Reading the objects themselves removes the dependency on a second index
 * being correct, and costs one prefix listing instead of one per repository.
 */
async function listAllUnder<T>(prefix: string): Promise<T[]> {
  const keys = await listState(prefix);
  if (keys.length > MAX_OBJECTS_SCANNED) {
    logger.warn("github.projection.listing_truncated", {
      prefix,
      found: keys.length,
      scanned: MAX_OBJECTS_SCANNED,
    });
  }
  // Promise.all widens to Awaited<T>, and T is unconstrained here, so the
  // compiler cannot know T is not itself a thenable. Every caller passes a
  // plain entity interface, so this narrows once, in one place, rather than
  // pushing the assertion out to all five callers.
  const records = (await Promise.all(
    keys.slice(0, MAX_OBJECTS_SCANNED).map((k) => readStateByKey<T>(k)),
  )) as Array<T | null>;
  return records.filter((r): r is T => r !== null);
}

/** Read a state object by its FULL bucket key (what listState returns),
 *  rather than by the store-relative path readState expects. */
async function readStateByKey<T>(fullKey: string): Promise<T | null> {
  const marker = "/state/";
  const at = fullKey.indexOf(marker);
  if (at === -1) return null;
  return readState<T>(fullKey.slice(at + marker.length));
}

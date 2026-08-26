// Event handlers.
//
// The governing rule, straight from the mandate: process asynchronously,
// idempotently, and tolerate out-of-order arrival by RECONCILING against the
// current state via the API rather than blindly applying deltas.
//
// So almost every handler here does the same thing: work out which entity the
// event concerns, then go and read that entity's CURRENT state from GitHub
// and store that. It deliberately does not trust the payload's own copy of
// the entity, because:
//
//   - a redelivered `closed` can arrive after a `reopened`, and applying the
//     payload would resurrect a stale state, whereas re-reading cannot;
//   - a payload is a snapshot from when the event fired, which may be minutes
//     old by the time a retry lands;
//   - it makes every handler naturally idempotent, which is what makes
//     at-least-once delivery safe.
//
// The cost is one API read per delivery. That is why the client has ETag
// support: a reconcile of an unchanged entity costs no rate budget.
//
// Where the payload IS the fact (a push's commit list, a deleted branch, an
// alert's state), the handler uses it directly, because there is nothing left
// to read.
import { GitHubError } from "./client";
import {
  fetchPullRequest,
  fetchRepo,
  fetchWorkflowRuns,
  toRepoEntity,
} from "./api";
import {
  deletePullRequest,
  deleteRepo,
  getRepo,
  putAlert,
  putDeployment,
  putPullRequest,
  putRelease,
  putRepo,
  putWorkflowRun,
} from "./projection";
import { toActor, toWorkflowRunEntity } from "./entities";
import {
  CheckRunEvent,
  CheckSuiteEvent,
  CodeScanningAlertEvent,
  CreateDeleteEvent,
  DependabotAlertEvent,
  DeploymentEvent,
  DeploymentStatusEvent,
  InstallationEvent,
  IssueCommentEvent,
  IssuesEvent,
  MergeGroupEvent,
  PullRequestEvent,
  PullRequestReviewCommentEvent,
  PullRequestReviewEvent,
  PullRequestReviewThreadEvent,
  PushEvent,
  ReleaseEvent,
  RepositoryEvent,
  SecretScanningAlertEvent,
  SecretScanningAlertEvent as _SecretAlias,
  StatusEvent,
  WorkflowJobEvent,
  WorkflowRunEvent,
} from "./schema";

void _SecretAlias;

export type HandlerResult = {
  /** Human-readable summary for the delivery log. */
  summary: string;
  /** Entities touched, so the UI can invalidate precisely. */
  touched?: { kind: string; id: string }[];
};

export type HandlerContext = {
  event: string;
  deliveryId: string;
  payload: unknown;
};

/** Reconcile one pull request from the API and store it. Returns a summary.
 *  A 404 means the PR (or its repo) is gone, so the projection is removed
 *  rather than left as a tombstone the inbox would keep showing. */
async function reconcilePullRequest(
  repo: string,
  number: number,
  note: string,
): Promise<HandlerResult> {
  try {
    const entity = await fetchPullRequest(repo, number);
    if (!entity) {
      await deletePullRequest(repo, number);
      return { summary: `${repo}#${number} no longer exists, projection removed` };
    }
    const { written } = await putPullRequest(entity);
    return {
      summary: written
        ? `${note}: reconciled ${repo}#${number}`
        : `${note}: ${repo}#${number} already newer, kept`,
      touched: [{ kind: "pull_request", id: `${repo}#${number}` }],
    };
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) {
      await deletePullRequest(repo, number);
      return { summary: `${repo}#${number} not found, projection removed` };
    }
    throw e;
  }
}

/** The repo full name from any payload that carries one. */
function repoOf(payload: unknown): string | null {
  const repo = (payload as { repository?: { full_name?: string } })?.repository?.full_name;
  return typeof repo === "string" ? repo : null;
}

type Handler = (ctx: HandlerContext) => Promise<HandlerResult>;

const handlers: Record<string, Handler> = {
  // ——— pull requests ———
  // Every action (opened, closed, reopened, ready_for_review,
  // converted_to_draft, synchronize, assigned, review_requested, labeled,
  // edited including a base change) funnels into one reconcile. That is the
  // whole point: we do not need per-action logic when we re-read the truth.
  pull_request: async ({ payload }) => {
    const data = PullRequestEvent.parse(payload);
    const repo = repoOf(payload);
    if (!repo) return { summary: "pull_request without a repository, skipped" };
    return reconcilePullRequest(repo, data.pull_request.number, `pull_request.${data.action}`);
  },

  pull_request_review: async ({ payload }) => {
    const data = PullRequestReviewEvent.parse(payload);
    const repo = repoOf(payload);
    if (!repo) return { summary: "pull_request_review without a repository, skipped" };
    // A dismissed review changes merge readiness, so the whole PR is
    // re-derived rather than the review list being patched in place.
    return reconcilePullRequest(repo, data.pull_request.number, `review.${data.action}`);
  },

  pull_request_review_comment: async ({ payload }) => {
    const data = PullRequestReviewCommentEvent.parse(payload);
    const repo = repoOf(payload);
    if (!repo) return { summary: "review comment without a repository, skipped" };
    return reconcilePullRequest(repo, data.pull_request.number, "review_comment");
  },

  pull_request_review_thread: async ({ payload }) => {
    const data = PullRequestReviewThreadEvent.parse(payload);
    const repo = repoOf(payload);
    if (!repo) return { summary: "review thread without a repository, skipped" };
    // Resolving a thread can unblock a merge, so this must refresh readiness.
    return reconcilePullRequest(repo, data.pull_request.number, `thread.${data.action}`);
  },

  // ——— checks and runs ———
  // A check event names its PRs. When it does not (a check on a branch with
  // no PR), there is nothing to project onto and it is recorded as handled.
  check_run: async ({ payload }) => {
    const data = CheckRunEvent.parse(payload);
    const repo = repoOf(payload);
    if (!repo) return { summary: "check_run without a repository, skipped" };
    const numbers = [
      ...(data.check_run.pull_requests ?? []),
      ...(data.check_run.check_suite?.pull_requests ?? []),
    ].map((p) => p.number);
    const unique = [...new Set(numbers)];
    if (!unique.length) {
      return { summary: `check_run ${data.check_run.name} on ${repo}, no associated PR` };
    }
    const results = await Promise.all(
      unique.map((n) => reconcilePullRequest(repo, n, `check_run.${data.action}`)),
    );
    return {
      summary: results.map((r) => r.summary).join("; "),
      touched: results.flatMap((r) => r.touched ?? []),
    };
  },

  check_suite: async ({ payload }) => {
    const data = CheckSuiteEvent.parse(payload);
    const repo = repoOf(payload);
    if (!repo) return { summary: "check_suite without a repository, skipped" };
    const numbers = (data.check_suite.pull_requests ?? []).map((p) => p.number);
    if (!numbers.length) {
      return { summary: `check_suite on ${repo}@${data.check_suite.head_sha.slice(0, 7)}, no PR` };
    }
    const results = await Promise.all(
      numbers.map((n) => reconcilePullRequest(repo, n, `check_suite.${data.action}`)),
    );
    return {
      summary: results.map((r) => r.summary).join("; "),
      touched: results.flatMap((r) => r.touched ?? []),
    };
  },

  // The legacy commit status API. It carries no PR reference at all, so the
  // only way to connect it is by head SHA, which the reconciler does when the
  // PR is next read. Recording it keeps the delivery history complete.
  status: async ({ payload }) => {
    const data = StatusEvent.parse(payload);
    const repo = repoOf(payload);
    return {
      summary: `status ${data.context} ${data.state} on ${repo ?? "unknown"}@${data.sha.slice(0, 7)}`,
    };
  },

  workflow_run: async ({ payload }) => {
    const data = WorkflowRunEvent.parse(payload);
    const repo = repoOf(payload);
    if (!repo) return { summary: "workflow_run without a repository, skipped" };
    await putWorkflowRun(toWorkflowRunEntity(repo, data.workflow_run));
    // A completed run changes check state on any PR at that SHA.
    const numbers = (data.workflow_run.pull_requests ?? []).map((p) => p.number);
    await Promise.all(numbers.map((n) => reconcilePullRequest(repo, n, "workflow_run")));
    return {
      // A run whose workflow file was deleted arrives with a null name, which
      // rendered as a double space. "workflow" matches what
      // toWorkflowRunEntity already stores for the same case.
      summary: `workflow_run ${data.workflow_run.name ?? "workflow"} ${data.action} on ${repo}`,
      touched: [{ kind: "workflow_run", id: `${repo}#${data.workflow_run.id}` }],
    };
  },

  workflow_job: async ({ payload }) => {
    const data = WorkflowJobEvent.parse(payload);
    const repo = repoOf(payload);
    // Job-level events are high volume and their useful content (the failing
    // step) is fetched on demand by the CI panel rather than stored per job.
    return {
      summary: `workflow_job ${data.workflow_job.name} ${data.workflow_job.status} on ${repo ?? "unknown"}`,
    };
  },

  // ——— repository lifecycle ———
  // Rename, transfer, privatisation, archival and deletion all invalidate
  // references we hold, which is exactly the edge case list in section 3.7.
  repository: async ({ payload }) => {
    const data = RepositoryEvent.parse(payload);
    const repo = repoOf(payload);
    if (!repo) return { summary: "repository event without a repository, skipped" };

    if (data.action === "deleted") {
      await deleteRepo(repo);
      return { summary: `repository ${repo} deleted, projection removed` };
    }

    // On a rename the payload's full_name is the NEW name and changes.repository
    // .name.from is the old one; the old projection must go or the repo list
    // shows both.
    const previousName = data.changes?.repository?.name?.from;
    if (data.action === "renamed" && previousName) {
      const owner = repo.split("/")[0];
      await deleteRepo(`${owner}/${previousName}`);
    }

    const fresh = await fetchRepo(repo);
    if (!fresh) {
      await deleteRepo(repo);
      return { summary: `repository ${repo} unreadable, projection removed` };
    }
    await putRepo(fresh);
    return {
      summary: `repository.${data.action}: reconciled ${repo}`,
      touched: [{ kind: "repository", id: repo }],
    };
  },

  push: async ({ payload }) => {
    const data = PushEvent.parse(payload);
    const repo = repoOf(payload);
    if (!repo) return { summary: "push without a repository, skipped" };

    // A force push invalidates any head SHA we cached for this ref. We cannot
    // know which PRs point at it without a lookup, and the PR's own
    // `synchronize` event will follow, so this records the fact and lets the
    // reconcile handle correctness.
    const branch = data.ref.replace(/^refs\/heads\//, "");
    const count = data.commits?.length ?? 0;
    const forced = data.forced === true ? ", force pushed" : "";

    // Refresh the repo projection so pushedAt and open counts stay live.
    const existing = await getRepo(repo);
    if (existing) {
      await putRepo({ ...existing, pushedAt: new Date().toISOString() });
    }

    return {
      summary: `push ${count} commit${count === 1 ? "" : "s"} to ${repo}:${branch}${forced}`,
      touched: [{ kind: "repository", id: repo }],
    };
  },

  create: async ({ payload }) => {
    const data = CreateDeleteEvent.parse(payload);
    return { summary: `created ${data.ref_type} ${data.ref} on ${repoOf(payload) ?? "unknown"}` };
  },

  delete: async ({ payload }) => {
    const data = CreateDeleteEvent.parse(payload);
    // A deleted branch means any PR from it is closed; GitHub sends the PR
    // event too, so this is a log entry rather than a projection change.
    return { summary: `deleted ${data.ref_type} ${data.ref} on ${repoOf(payload) ?? "unknown"}` };
  },

  // ——— issues ———
  issues: async ({ payload }) => {
    const data = IssuesEvent.parse(payload);
    return {
      summary: `issues.${data.action} #${data.issue.number} on ${repoOf(payload) ?? "unknown"}`,
    };
  },

  issue_comment: async ({ payload }) => {
    const data = IssueCommentEvent.parse(payload);
    const repo = repoOf(payload);
    // An "issue comment" on a PR is a PR conversation comment: same endpoint,
    // different entity. `issue.pull_request` is the only discriminator.
    if (data.issue.pull_request && repo) {
      return reconcilePullRequest(repo, data.issue.number, `issue_comment.${data.action}`);
    }
    return {
      summary: `issue_comment.${data.action} on #${data.issue.number} of ${repo ?? "unknown"}`,
    };
  },

  // ——— deployments and releases ———
  deployment: async ({ payload }) => {
    const data = DeploymentEvent.parse(payload);
    const repo = repoOf(payload);
    if (!repo) return { summary: "deployment without a repository, skipped" };
    const creator = toActor(data.deployment.creator);
    await putDeployment({
      id: data.deployment.id,
      repo,
      environment: data.deployment.environment,
      ref: data.deployment.ref,
      sha: data.deployment.sha,
      // A deployment with no status yet is pending by definition.
      state: "pending",
      ...(data.deployment.description ? { description: data.deployment.description } : {}),
      createdAt: data.deployment.created_at,
      ...(creator ? { creator } : {}),
    });
    return {
      summary: `deployment to ${data.deployment.environment} on ${repo}`,
      touched: [{ kind: "deployment", id: `${repo}#${data.deployment.id}` }],
    };
  },

  deployment_status: async ({ payload }) => {
    const data = DeploymentStatusEvent.parse(payload);
    const repo = repoOf(payload);
    if (!repo) return { summary: "deployment_status without a repository, skipped" };
    const creator = toActor(data.deployment.creator);
    await putDeployment({
      id: data.deployment.id,
      repo,
      environment: data.deployment_status.environment ?? data.deployment.environment,
      ref: data.deployment.ref,
      sha: data.deployment.sha,
      state: data.deployment_status.state,
      ...(data.deployment_status.description
        ? { description: data.deployment_status.description }
        : {}),
      ...(data.deployment_status.environment_url
        ? { environmentUrl: data.deployment_status.environment_url }
        : {}),
      createdAt: data.deployment.created_at,
      updatedAt: data.deployment_status.created_at,
      ...(creator ? { creator } : {}),
    });
    return {
      summary: `deployment ${data.deployment_status.state} in ${data.deployment_status.environment ?? data.deployment.environment} on ${repo}`,
      touched: [{ kind: "deployment", id: `${repo}#${data.deployment.id}` }],
    };
  },

  release: async ({ payload }) => {
    const data = ReleaseEvent.parse(payload);
    const repo = repoOf(payload);
    if (!repo) return { summary: "release without a repository, skipped" };
    const author = toActor(data.release.author);
    await putRelease({
      id: data.release.id,
      repo,
      tagName: data.release.tag_name,
      ...(data.release.name ? { name: data.release.name } : {}),
      ...(data.release.body ? { body: data.release.body } : {}),
      draft: data.release.draft === true,
      prerelease: data.release.prerelease === true,
      ...(data.release.published_at ? { publishedAt: data.release.published_at } : {}),
      ...(data.release.html_url ? { url: data.release.html_url } : {}),
      ...(author ? { author } : {}),
    });
    return {
      summary: `release.${data.action} ${data.release.tag_name} on ${repo}`,
      touched: [{ kind: "release", id: `${repo}#${data.release.id}` }],
    };
  },

  // ——— security alerts ———
  // The alert payload IS the fact here: there is no cheaper read that tells
  // us more, so these apply directly.
  dependabot_alert: async ({ payload }) => {
    const data = DependabotAlertEvent.parse(payload);
    const repo = repoOf(payload);
    if (!repo) return { summary: "dependabot_alert without a repository, skipped" };
    const pkg = data.alert.dependency?.package?.name;
    await putAlert({
      repo,
      kind: "dependabot",
      number: data.alert.number,
      state: data.alert.state,
      ...(data.alert.security_advisory?.severity
        ? { severity: data.alert.security_advisory.severity }
        : {}),
      title:
        data.alert.security_advisory?.summary ??
        (pkg ? `Vulnerability in ${pkg}` : `Dependabot alert ${data.alert.number}`),
      ...(data.alert.created_at ? { createdAt: data.alert.created_at } : {}),
      ...(data.alert.html_url ? { url: data.alert.html_url } : {}),
    });
    return { summary: `dependabot_alert.${data.action} #${data.alert.number} on ${repo}` };
  },

  code_scanning_alert: async ({ payload }) => {
    const data = CodeScanningAlertEvent.parse(payload);
    const repo = repoOf(payload);
    if (!repo) return { summary: "code_scanning_alert without a repository, skipped" };
    await putAlert({
      repo,
      kind: "code_scanning",
      number: data.alert.number,
      state: data.alert.state,
      ...(data.alert.rule?.severity ? { severity: data.alert.rule.severity } : {}),
      title: data.alert.rule?.description ?? `Code scanning alert ${data.alert.number}`,
      ...(data.alert.created_at ? { createdAt: data.alert.created_at } : {}),
      ...(data.alert.html_url ? { url: data.alert.html_url } : {}),
    });
    return { summary: `code_scanning_alert.${data.action} #${data.alert.number} on ${repo}` };
  },

  secret_scanning_alert: async ({ payload }) => {
    const data = SecretScanningAlertEvent.parse(payload);
    const repo = repoOf(payload);
    if (!repo) return { summary: "secret_scanning_alert without a repository, skipped" };
    await putAlert({
      repo,
      kind: "secret_scanning",
      number: data.alert.number,
      state: data.alert.state,
      // A leaked credential is always treated as critical: there is no
      // severity field on these, and defaulting to unknown would sort a live
      // secret below a moderate dependency warning.
      severity: "critical",
      title: data.alert.secret_type_display_name ?? data.alert.secret_type ?? "Secret detected",
      ...(data.alert.created_at ? { createdAt: data.alert.created_at } : {}),
      ...(data.alert.html_url ? { url: data.alert.html_url } : {}),
    });
    return { summary: `secret_scanning_alert.${data.action} #${data.alert.number} on ${repo}` };
  },

  // ——— merge queue ———
  merge_group: async ({ payload }) => {
    const data = MergeGroupEvent.parse(payload);
    return {
      summary: `merge_group.${data.action} ${data.merge_group.head_sha.slice(0, 7)} on ${repoOf(payload) ?? "unknown"}`,
    };
  },

  // ——— our own access ———
  // These matter more than they look: if the installation is suspended or
  // loses a repository, deliveries simply stop, and without this we would
  // read that as a quiet week.
  installation: async ({ payload }) => {
    const data = InstallationEvent.parse(payload);
    const suspended = data.installation.suspended_at ? ", SUSPENDED" : "";
    return {
      summary: `installation.${data.action}${suspended} for ${data.installation.account?.login ?? "unknown"}`,
    };
  },

  installation_repositories: async ({ payload }) => {
    const data = InstallationEvent.parse(payload);
    const added = data.repositories_added?.length ?? 0;
    const removed = data.repositories_removed?.length ?? 0;
    // A removed repository's projection is stale from this moment on.
    for (const repo of data.repositories_removed ?? []) {
      await deleteRepo(repo.full_name).catch(() => {});
    }
    // An added repository should appear without waiting for its first push.
    for (const repo of data.repositories_added ?? []) {
      const fresh = await fetchRepo(repo.full_name).catch(() => null);
      if (fresh) await putRepo(fresh);
    }
    return {
      summary: `installation_repositories.${data.action}: ${added} added, ${removed} removed`,
    };
  },

  member: async ({ payload }) => {
    // This handler only logs, so there is nothing to validate a payload for.
    // It previously parsed against InstallationEvent and discarded the result,
    // which was both dead work and the wrong schema: schema.ts maps `member`
    // to MembershipEvent.
    return { summary: `member event on ${repoOf(payload) ?? "unknown"}` };
  },

  membership: async ({ payload }) => ({
    summary: `membership event on ${repoOf(payload) ?? "the organization"}`,
  }),

  organization: async ({ payload }) => ({
    summary: `organization event on ${repoOf(payload) ?? "the organization"}`,
  }),

  branch_protection_rule: async ({ payload }) => ({
    summary: `branch_protection_rule changed on ${repoOf(payload) ?? "unknown"}`,
  }),
};

/** Whether we have a handler for this event type. */
export const hasHandler = (event: string): boolean =>
  Object.prototype.hasOwnProperty.call(handlers, event);

/** Run the handler for one delivery. Throws on failure so the caller can
 *  record the attempt and schedule a retry. */
export async function handleEvent(ctx: HandlerContext): Promise<HandlerResult> {
  const handler = handlers[ctx.event];
  if (!handler) {
    return { summary: `No handler for ${ctx.event}, acknowledged without processing` };
  }
  return handler(ctx);
}

/** Refresh recent workflow runs for a repo. Used by reconciliation rather
 *  than by a handler, because runs arrive in volume and a periodic sweep is
 *  cheaper than storing every job event. */
export async function syncWorkflowRuns(repo: string, limit = 50): Promise<number> {
  const runs = await fetchWorkflowRuns(repo, limit);
  await Promise.all(runs.map((r) => putWorkflowRun(r)));
  return runs.length;
}

export { toRepoEntity };

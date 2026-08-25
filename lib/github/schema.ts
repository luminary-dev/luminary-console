// Zod schemas for every GitHub payload we consume.
//
// Why validate at all when GitHub is a stable API: because "stable" means
// they add fields and occasionally change a type, and an unvalidated payload
// turns that into `undefined` three layers down, at render time, on a page
// showing money or merge readiness. Validating at the boundary turns it into
// one legible error next to the delivery that caused it, which we can then
// see in the dead letter queue.
//
// Every object is LOOSE (unknown keys pass through). GitHub adds fields
// constantly and a strict schema would reject perfectly good deliveries. We
// validate the shape of what we READ, not the whole payload.
import { z } from "zod";

// ——— shared fragments ———

export const GhUser = z.looseObject({
  // A deleted account can leave a null actor on older events, so callers must
  // handle absence: this is nullable at the fragment level rather than being
  // patched at every use site.
  id: z.number().int(),
  login: z.string(),
  avatar_url: z.string().optional(),
  html_url: z.string().optional(),
  type: z.string().optional(),
});
export type GhUser = z.infer<typeof GhUser>;

export const GhRepo = z.looseObject({
  id: z.number().int(),
  node_id: z.string().optional(),
  name: z.string(),
  full_name: z.string(),
  private: z.boolean().optional(),
  archived: z.boolean().optional(),
  disabled: z.boolean().optional(),
  fork: z.boolean().optional(),
  default_branch: z.string().optional(),
  html_url: z.string().optional(),
  description: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  open_issues_count: z.number().int().optional(),
  pushed_at: z.union([z.string(), z.number()]).nullable().optional(),
  license: z.looseObject({ spdx_id: z.string().nullable() }).nullable().optional(),
  owner: GhUser.nullable().optional(),
});
export type GhRepo = z.infer<typeof GhRepo>;

export const GhLabel = z.looseObject({
  id: z.number().int().optional(),
  name: z.string(),
  color: z.string().optional(),
  description: z.string().nullable().optional(),
});

export const GhRef = z.looseObject({
  ref: z.string(),
  sha: z.string(),
  label: z.string().optional(),
  // A fork's head repo can be null once the fork is deleted.
  repo: GhRepo.nullable().optional(),
  user: GhUser.nullable().optional(),
});

export const GhPullRequest = z.looseObject({
  id: z.number().int(),
  node_id: z.string().optional(),
  number: z.number().int(),
  state: z.string(),
  title: z.string(),
  body: z.string().nullable().optional(),
  draft: z.boolean().optional(),
  merged: z.boolean().optional(),
  merged_at: z.string().nullable().optional(),
  mergeable: z.boolean().nullable().optional(),
  mergeable_state: z.string().optional(),
  merge_commit_sha: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  closed_at: z.string().nullable().optional(),
  html_url: z.string().optional(),
  comments: z.number().int().optional(),
  review_comments: z.number().int().optional(),
  commits: z.number().int().optional(),
  additions: z.number().int().optional(),
  deletions: z.number().int().optional(),
  changed_files: z.number().int().optional(),
  user: GhUser.nullable().optional(),
  assignees: z.array(GhUser).optional(),
  requested_reviewers: z.array(GhUser).optional(),
  labels: z.array(GhLabel).optional(),
  head: GhRef,
  base: GhRef,
});
export type GhPullRequest = z.infer<typeof GhPullRequest>;

export const GhIssue = z.looseObject({
  id: z.number().int(),
  number: z.number().int(),
  state: z.string(),
  title: z.string(),
  body: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  closed_at: z.string().nullable().optional(),
  html_url: z.string().optional(),
  user: GhUser.nullable().optional(),
  assignees: z.array(GhUser).optional(),
  labels: z.array(GhLabel).optional(),
  // Present only when the "issue" is actually a pull request.
  pull_request: z.looseObject({ url: z.string().optional() }).optional(),
});

export const GhReview = z.looseObject({
  id: z.number().int(),
  state: z.string(),
  body: z.string().nullable().optional(),
  submitted_at: z.string().nullable().optional(),
  html_url: z.string().optional(),
  commit_id: z.string().nullable().optional(),
  user: GhUser.nullable().optional(),
});

export const GhCheckRun = z.looseObject({
  id: z.number().int(),
  name: z.string(),
  head_sha: z.string(),
  status: z.string(),
  // `conclusion` is null while queued/in-progress, and can legitimately be
  // "neutral" or "skipped", which must not be rendered as a failure.
  conclusion: z.string().nullable().optional(),
  started_at: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  html_url: z.string().nullable().optional(),
  details_url: z.string().nullable().optional(),
  output: z
    .looseObject({
      title: z.string().nullable().optional(),
      summary: z.string().nullable().optional(),
      text: z.string().nullable().optional(),
    })
    .optional(),
});
export type GhCheckRun = z.infer<typeof GhCheckRun>;

export const GhCheckSuite = z.looseObject({
  id: z.number().int(),
  head_sha: z.string(),
  status: z.string(),
  conclusion: z.string().nullable().optional(),
  head_branch: z.string().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  pull_requests: z.array(z.looseObject({ number: z.number().int() })).optional(),
});

export const GhWorkflowRun = z.looseObject({
  id: z.number().int(),
  name: z.string().nullable().optional(),
  head_branch: z.string().nullable().optional(),
  head_sha: z.string(),
  status: z.string(),
  conclusion: z.string().nullable().optional(),
  event: z.string().optional(),
  run_number: z.number().int().optional(),
  run_attempt: z.number().int().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  run_started_at: z.string().optional(),
  html_url: z.string().optional(),
  actor: GhUser.nullable().optional(),
  pull_requests: z.array(z.looseObject({ number: z.number().int() })).optional(),
});
export type GhWorkflowRun = z.infer<typeof GhWorkflowRun>;

export const GhWorkflowJob = z.looseObject({
  id: z.number().int(),
  run_id: z.number().int(),
  name: z.string(),
  status: z.string(),
  conclusion: z.string().nullable().optional(),
  started_at: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  html_url: z.string().nullable().optional(),
  steps: z
    .array(
      z.looseObject({
        name: z.string(),
        status: z.string(),
        conclusion: z.string().nullable().optional(),
        number: z.number().int().optional(),
      }),
    )
    .optional(),
});

export const GhDeployment = z.looseObject({
  id: z.number().int(),
  sha: z.string(),
  ref: z.string(),
  task: z.string().optional(),
  environment: z.string(),
  description: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string().optional(),
  creator: GhUser.nullable().optional(),
});

export const GhDeploymentStatus = z.looseObject({
  id: z.number().int(),
  state: z.string(),
  environment: z.string().optional(),
  environment_url: z.string().nullable().optional(),
  log_url: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  created_at: z.string(),
  creator: GhUser.nullable().optional(),
});

export const GhRelease = z.looseObject({
  id: z.number().int(),
  tag_name: z.string(),
  name: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional(),
  created_at: z.string(),
  published_at: z.string().nullable().optional(),
  html_url: z.string().optional(),
  author: GhUser.nullable().optional(),
});

const GhAlertBase = z.looseObject({
  number: z.number().int(),
  state: z.string(),
  created_at: z.string().optional(),
  updated_at: z.string().nullable().optional(),
  html_url: z.string().nullable().optional(),
});

// ——— event envelopes ———
// Each carries the fields the corresponding handler reads. `action` is
// deliberately a plain string, not an enum: GitHub adds actions to existing
// events, and rejecting an unknown action would drop a delivery we could have
// reconciled from the API anyway.

const base = { repository: GhRepo.optional(), sender: GhUser.nullable().optional() };

export const PullRequestEvent = z.looseObject({
  ...base,
  action: z.string(),
  number: z.number().int().optional(),
  pull_request: GhPullRequest,
  label: GhLabel.optional(),
  requested_reviewer: GhUser.nullable().optional(),
  // Present on a retarget: tells us the base branch moved.
  changes: z
    .looseObject({ base: z.looseObject({ ref: z.looseObject({ from: z.string() }) }).optional() })
    .optional(),
});

export const PullRequestReviewEvent = z.looseObject({
  ...base,
  action: z.string(),
  review: GhReview,
  pull_request: GhPullRequest,
});

export const PullRequestReviewCommentEvent = z.looseObject({
  ...base,
  action: z.string(),
  comment: z.looseObject({
    id: z.number().int(),
    body: z.string().nullable().optional(),
    path: z.string().nullable().optional(),
    line: z.number().int().nullable().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
    html_url: z.string().optional(),
    user: GhUser.nullable().optional(),
    in_reply_to_id: z.number().int().optional(),
  }),
  pull_request: GhPullRequest,
});

export const PullRequestReviewThreadEvent = z.looseObject({
  ...base,
  action: z.string(),
  thread: z.looseObject({
    node_id: z.string().optional(),
    comments: z.array(z.looseObject({ id: z.number().int() })).optional(),
  }),
  pull_request: GhPullRequest,
});

export const IssuesEvent = z.looseObject({
  ...base,
  action: z.string(),
  issue: GhIssue,
  label: GhLabel.optional(),
});

export const IssueCommentEvent = z.looseObject({
  ...base,
  action: z.string(),
  issue: GhIssue,
  comment: z.looseObject({
    id: z.number().int(),
    body: z.string().nullable().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
    html_url: z.string().optional(),
    user: GhUser.nullable().optional(),
  }),
});

export const PushEvent = z.looseObject({
  ...base,
  ref: z.string(),
  before: z.string(),
  after: z.string(),
  created: z.boolean().optional(),
  deleted: z.boolean().optional(),
  // A force push invalidates any head SHA we cached for this ref.
  forced: z.boolean().optional(),
  commits: z
    .array(
      z.looseObject({
        id: z.string(),
        message: z.string(),
        timestamp: z.string().optional(),
        url: z.string().optional(),
        // A commit with no author email is legal in git and arrives as an
        // empty string, so this must not be a required, non-empty field.
        author: z
          .looseObject({
            name: z.string().optional(),
            email: z.string().nullable().optional(),
            username: z.string().optional(),
          })
          .optional(),
      }),
    )
    .optional(),
  head_commit: z.looseObject({ id: z.string(), message: z.string() }).nullable().optional(),
  pusher: z.looseObject({ name: z.string().optional() }).optional(),
});

export const CreateDeleteEvent = z.looseObject({
  ...base,
  ref: z.string(),
  ref_type: z.string(),
});

export const CheckRunEvent = z.looseObject({
  ...base,
  action: z.string(),
  check_run: GhCheckRun.extend({
    check_suite: z
      .looseObject({
        id: z.number().int().optional(),
        pull_requests: z.array(z.looseObject({ number: z.number().int() })).optional(),
      })
      .optional(),
    pull_requests: z.array(z.looseObject({ number: z.number().int() })).optional(),
  }),
});

export const CheckSuiteEvent = z.looseObject({
  ...base,
  action: z.string(),
  check_suite: GhCheckSuite,
});

export const StatusEvent = z.looseObject({
  ...base,
  id: z.number().int().optional(),
  sha: z.string(),
  state: z.string(),
  context: z.string(),
  description: z.string().nullable().optional(),
  target_url: z.string().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export const WorkflowRunEvent = z.looseObject({
  ...base,
  action: z.string(),
  workflow_run: GhWorkflowRun,
  workflow: z.looseObject({ id: z.number().int(), name: z.string(), path: z.string().optional() }).optional(),
});

export const WorkflowJobEvent = z.looseObject({
  ...base,
  action: z.string(),
  workflow_job: GhWorkflowJob,
});

export const DeploymentEvent = z.looseObject({
  ...base,
  action: z.string().optional(),
  deployment: GhDeployment,
});

export const DeploymentStatusEvent = z.looseObject({
  ...base,
  action: z.string().optional(),
  deployment: GhDeployment,
  deployment_status: GhDeploymentStatus,
});

export const ReleaseEvent = z.looseObject({
  ...base,
  action: z.string(),
  release: GhRelease,
});

export const RepositoryEvent = z.looseObject({
  ...base,
  action: z.string(),
  // A rename carries the previous name, which is the only way to find the
  // record we already hold.
  changes: z
    .looseObject({
      repository: z
        .looseObject({ name: z.looseObject({ from: z.string() }).optional() })
        .optional(),
      owner: z.looseObject({ from: z.looseObject({}).optional() }).optional(),
    })
    .optional(),
});

export const MembershipEvent = z.looseObject({
  ...base,
  action: z.string(),
  member: GhUser.nullable().optional(),
  scope: z.string().optional(),
  team: z.looseObject({ name: z.string().optional() }).optional(),
});

export const OrganizationEvent = z.looseObject({
  ...base,
  action: z.string(),
  membership: z.looseObject({ user: GhUser.nullable().optional(), role: z.string().optional() }).optional(),
});

export const BranchProtectionRuleEvent = z.looseObject({
  ...base,
  action: z.string(),
  rule: z.looseObject({
    id: z.number().int().optional(),
    name: z.string().optional(),
    pattern: z.string().optional(),
  }),
});

export const DependabotAlertEvent = z.looseObject({
  ...base,
  action: z.string(),
  alert: GhAlertBase.extend({
    security_advisory: z
      .looseObject({
        ghsa_id: z.string().optional(),
        summary: z.string().optional(),
        severity: z.string().optional(),
      })
      .optional(),
    dependency: z
      .looseObject({
        package: z.looseObject({ name: z.string().optional(), ecosystem: z.string().optional() }).optional(),
      })
      .optional(),
  }),
});

export const CodeScanningAlertEvent = z.looseObject({
  ...base,
  action: z.string(),
  alert: GhAlertBase.extend({
    rule: z
      .looseObject({
        id: z.string().optional(),
        severity: z.string().nullable().optional(),
        description: z.string().optional(),
      })
      .optional(),
  }),
});

export const SecretScanningAlertEvent = z.looseObject({
  ...base,
  action: z.string(),
  alert: GhAlertBase.extend({
    secret_type: z.string().optional(),
    secret_type_display_name: z.string().optional(),
  }),
});

export const MergeGroupEvent = z.looseObject({
  ...base,
  action: z.string(),
  merge_group: z.looseObject({
    head_sha: z.string(),
    base_sha: z.string().optional(),
    head_ref: z.string().optional(),
    base_ref: z.string().optional(),
  }),
});

/** installation and installation_repositories tell us our own access changed,
 *  which is the difference between "quiet week" and "we stopped receiving
 *  anything an hour ago". */
export const InstallationEvent = z.looseObject({
  ...base,
  action: z.string(),
  installation: z.looseObject({
    id: z.number().int(),
    account: GhUser.nullable().optional(),
    repository_selection: z.string().optional(),
    suspended_at: z.string().nullable().optional(),
  }),
  repositories: z.array(z.looseObject({ full_name: z.string() })).optional(),
  repositories_added: z.array(z.looseObject({ full_name: z.string() })).optional(),
  repositories_removed: z.array(z.looseObject({ full_name: z.string() })).optional(),
});

/** Every event type we accept, mapped to its schema. An event that is not
 *  here is stored in the inbox and acknowledged, but not processed: we would
 *  rather keep an unknown delivery than 400 it, because GitHub disables a
 *  webhook that keeps failing. */
export const EVENT_SCHEMAS = {
  pull_request: PullRequestEvent,
  pull_request_review: PullRequestReviewEvent,
  pull_request_review_comment: PullRequestReviewCommentEvent,
  pull_request_review_thread: PullRequestReviewThreadEvent,
  issues: IssuesEvent,
  issue_comment: IssueCommentEvent,
  push: PushEvent,
  create: CreateDeleteEvent,
  delete: CreateDeleteEvent,
  check_run: CheckRunEvent,
  check_suite: CheckSuiteEvent,
  status: StatusEvent,
  workflow_run: WorkflowRunEvent,
  workflow_job: WorkflowJobEvent,
  deployment: DeploymentEvent,
  deployment_status: DeploymentStatusEvent,
  release: ReleaseEvent,
  repository: RepositoryEvent,
  member: MembershipEvent,
  membership: MembershipEvent,
  organization: OrganizationEvent,
  branch_protection_rule: BranchProtectionRuleEvent,
  dependabot_alert: DependabotAlertEvent,
  code_scanning_alert: CodeScanningAlertEvent,
  secret_scanning_alert: SecretScanningAlertEvent,
  merge_group: MergeGroupEvent,
  installation: InstallationEvent,
  installation_repositories: InstallationEvent,
} as const;

export type KnownEvent = keyof typeof EVENT_SCHEMAS;

export const isKnownEvent = (event: string): event is KnownEvent =>
  Object.prototype.hasOwnProperty.call(EVENT_SCHEMAS, event);

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; issues: string[] };

/** Validate a raw payload against its event schema. Returns readable issue
 *  strings rather than a Zod error object, because these end up in the dead
 *  letter UI where a human reads them. */
export function parseEvent(event: string, payload: unknown): ParseResult<unknown> {
  if (!isKnownEvent(event)) {
    return { ok: false, issues: [`Unhandled event type: ${event}`] };
  }
  const result = EVENT_SCHEMAS[event].safeParse(payload);
  if (result.success) return { ok: true, data: result.data };
  return {
    ok: false,
    issues: result.error.issues
      .slice(0, 10)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
  };
}

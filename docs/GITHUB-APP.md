# The Luminary Console GitHub App

The console talks to the `luminary-dev` organisation through a GitHub App, not
a personal access token. This document is the permission justification the
security policy requires, plus the installation, rotation and break-glass
procedures.

## Why an App rather than a PAT

The console previously used `GH_TOKEN`, a personal access token, and that path
still works as a fallback (see "Fallback" below). It is not the target:

- A PAT carries **one person's entire access**. If Dhanika's token is used by
  the console, every action is attributable to Dhanika and every repository
  Dhanika can reach is reachable by the console, including personal ones.
- A PAT cannot be scoped per repository selection the way an installation can.
- A PAT does not expire. An installation token lives one hour and is minted on
  demand, so a leaked token is a one-hour problem rather than a permanent one.
- Only an App can receive webhooks with a shared secret we control.

## Permissions requested, and why each one

The rule is read-only unless a write is strictly required by a feature in the
console. Every write permission below is used by an action that shows the
operator exactly what will happen and asks for confirmation first.

### Repository permissions

| Permission | Level | Why it is needed | Without it |
| --- | --- | --- | --- |
| Metadata | Read | Mandatory for every App. Repository names, default branch, visibility, archived state. | Nothing works. |
| Contents | Read | Commit lists, comparing head against base for the "behind by N" signal, reading a repo tarball for a client site deploy. | No branch-behind detection, no site deploys. |
| Contents | **Write** | "Update branch" on a pull request, which merges the base into the head. | Operators must leave the console to update a branch. |
| Pull requests | Read | The entire PR workspace: list, detail, reviews, review threads, files, diffs. | The centrepiece screen is empty. |
| Pull requests | **Write** | Approve, request changes, comment as a review, request reviewers, convert draft state, merge, close, reopen. | The console is read-only for PRs and every action means switching to github.com. |
| Issues | Read | Cross-repo issue triage, and PR conversation comments (which live on the issues API). | No issue views, no PR conversation. |
| Issues | **Write** | Adding and removing labels, posting a conversation comment on a PR. | No labelling, no commenting. |
| Checks | Read | Check runs and suites per commit, which drive merge readiness and the CI panel. | Merge readiness cannot see CI. |
| Commit statuses | Read | The legacy status API, still used by some integrations. | Older status checks are invisible. |
| Actions | Read | Workflow runs, jobs, durations, and the failing job's log for the extracted excerpt. | No CI intelligence, no log extraction. |
| Actions | **Write** | Re-run failed jobs. | Re-running a flake means leaving the console. |
| Deployments | Read | What is deployed where, by whom, when. | The deployments view is empty. |
| Administration | Read | Branch protection rules, so merge readiness can say "blocked by protection" rather than guessing. | Merge readiness cannot explain a protection block. |
| Dependabot alerts | Read | The security posture view. | No dependency alerts. |
| Code scanning alerts | Read | The security posture view. | No code scanning alerts. |
| Secret scanning alerts | Read | The security posture view. A leaked credential is the highest-urgency thing this console can show. | No secret alerts. |

### Organisation permissions

| Permission | Level | Why it is needed |
| --- | --- | --- |
| Members | Read | Resolving who is who, and noticing when someone leaves the org while the console still holds references to their work. |

### Deliberately NOT requested

These are commonly granted and we do not want them. Each is a decision, not an
oversight:

- **Contents: Admin** and **Administration: Write** — the console never
  changes repository or organisation settings. The mandate requires approval
  before altering anything in the org itself, and the safest way to honour
  that is to be unable to.
- **Members: Write** — the console never changes org membership.
- **Secrets** (read or write) — the console has no reason to see Actions
  secrets, and being unable to read them means a console compromise cannot
  leak them.
- **Workflows: Write** — the console never edits workflow files. Editing CI
  from a tool that runs on CI is a loop we do not want.
- **Packages**, **Pages**, **Environments: Write**, **Codespaces** — unused.

## Webhook events subscribed

`pull_request`, `pull_request_review`, `pull_request_review_comment`,
`pull_request_review_thread`, `issues`, `issue_comment`, `push`, `create`,
`delete`, `check_suite`, `check_run`, `status`, `workflow_run`, `workflow_job`,
`deployment`, `deployment_status`, `release`, `repository`, `member`,
`membership`, `organization`, `branch_protection_rule`, `dependabot_alert`,
`code_scanning_alert`, `secret_scanning_alert`, `merge_group`, `installation`,
`installation_repositories`.

`installation` and `installation_repositories` matter more than they look: if
the installation is suspended or loses a repository, deliveries simply stop,
and without those events a broken integration reads as a quiet week. See
`docs/WEBHOOKS.md` for the handler and idempotency strategy of each.

## Installation

1. Create the App at
   `https://github.com/organizations/luminary-dev/settings/apps/new`.
   - **Name**: Luminary Console
   - **Homepage**: `https://console.luminary-dev.xyz`
   - **Webhook URL**: `https://console.luminary-dev.xyz/api/github/webhook`
   - **Webhook secret**: generate 32+ random bytes
     (`openssl rand -hex 32`). This is the only thing standing between the
     internet and the webhook handler, so it is not optional.
   - **Permissions**: exactly the table above.
   - **Subscribe to events**: exactly the list above.
   - **Where can this App be installed**: only on this account.
2. Generate a private key and download the `.pem`.
3. Install the App on the `luminary-dev` organisation. Choose **All
   repositories** unless there is a reason to scope it; the console shows the
   whole org and a partial selection will look like missing data.
4. Note the **App ID** (App settings page) and the **Installation ID** (the
   number in the URL after installing: `.../installations/<id>`).
5. Set the environment variables (all environments):

   ```
   GITHUB_APP_ID=<app id>
   GITHUB_APP_PRIVATE_KEY=<contents of the .pem>
   GITHUB_APP_INSTALLATION_ID=<installation id>   # optional, saves a lookup
   GITHUB_WEBHOOK_SECRET=<the webhook secret>
   GITHUB_ORG=luminary-dev                        # optional, this is the default
   ```

   The private key is multi-line PEM. `vercel env add` handles it; if your
   tooling flattens newlines into `\n`, that is fine, the loader normalises
   both forms.
6. Redeploy, then run a backfill from the console (Admin, GitHub, Backfill) so
   the projection is populated without waiting for events.
7. Confirm: GitHub's App settings page has a **Recent Deliveries** tab. A
   green tick with a 200 response means the whole path works. A red entry
   there is the first place to look when something is wrong.

## Fallback: GH_TOKEN

If `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` are absent, the client falls
back to `GH_TOKEN`. This keeps the console working before the App exists, and
keeps the pre-existing client-site deploy path working. Webhooks do NOT work
in this mode, because there is no App to send them, so the projection is only
as fresh as the last backfill or reconcile. Treat it as a bootstrap mode.

## Rotation

Rotate the private key and the webhook secret on a schedule, and immediately
if either is suspected exposed.

**Private key**
1. Generate a second private key in the App settings. GitHub allows two at
   once, which is what makes this zero-downtime.
2. Update `GITHUB_APP_PRIVATE_KEY` and redeploy.
3. Confirm the console can still read GitHub (the rate limit badge in the top
   bar goes green, or run a reconcile).
4. Delete the old key in App settings.

**Webhook secret**
GitHub allows only one webhook secret, so this one is not zero-downtime.
1. Generate the new secret.
2. Update `GITHUB_WEBHOOK_SECRET` and redeploy FIRST.
3. Update the secret in the App settings.
4. Deliveries signed with the old secret during the gap are rejected with a
   401 and GitHub retries them. Anything permanently lost is recovered by a
   reconcile, which is exactly why reconciliation exists.
5. Run a reconcile and confirm the drift count returns to zero.

**Installation token** needs no rotation: it lives an hour and is minted on
demand. `invalidateToken()` drops the cached one if a 401 says it died early.

## Revoking access in an emergency

Suspend the installation at
`https://github.com/organizations/luminary-dev/settings/installations`. This
stops all API access and all webhook delivery immediately, without deleting
the App or its configuration. The console degrades to its stored projection
and says so. Un-suspending restores everything; run a reconcile afterwards to
catch up on what was missed.

## What the console will never do

Written down because it is easier to audit a promise than a codebase:

- It never changes repository or organisation settings.
- It never edits workflow files.
- It never reads Actions secrets.
- It never force-pushes, and it never deletes a branch.
- Every write action names the exact change in the UI and requires
  confirmation, and merge additionally requires the head SHA the operator was
  looking at, so a push landing mid-review cannot be merged unseen.
- Every mutating action is written to the console's audit log, attributed to
  the signed-in operator.

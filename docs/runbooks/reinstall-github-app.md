# Runbook: reinstalling the GitHub App

**When**: the App was removed from the organisation, its installation was
deleted, or it is being moved to a different org or account.

Full setup detail is in `docs/GITHUB-APP.md`. This is the recovery path.

## What breaks while it is uninstalled

- No webhook deliveries arrive. The console keeps serving its stored
  projection and reports its age.
- No API reads or writes succeed unless `GH_TOKEN` is set as a fallback.
- Nothing is lost. The projection, the delivery inbox and the audit log are
  all in our own store.

## 1. Reinstall

1. Go to `https://github.com/organizations/luminary-dev/settings/installations`.
2. If the App still exists but is suspended, un-suspend it and skip to step 4.
3. If the installation was deleted, install the App again from its public
   page or from the App settings, choosing the `luminary-dev` organisation.
4. Choose **All repositories** unless there is a specific reason not to. A
   partial selection looks exactly like missing data in the console.

## 2. Update the installation id

The installation id changes on a reinstall. If `GITHUB_APP_INSTALLATION_ID` is
set, it now points at a dead installation.

- Take the number from the URL after installing:
  `.../settings/installations/<id>`.
- Update the variable and redeploy. Or remove it entirely: the App resolves
  the installation for the org automatically, at the cost of one extra API
  call per cold start.

## 3. Confirm the webhook

Reinstalling does not change the App's webhook URL or secret, but confirm both:

- URL: `https://console.luminary-dev.xyz/api/github/webhook`
- Secret matches `GITHUB_WEBHOOK_SECRET` exactly.

Trigger any event (open a draft pull request on a scratch repo) and check
GitHub's **Recent Deliveries** tab for a 200.

## 4. Catch up on what was missed

```
POST /api/github/deliveries  {"action":"backfill"}
```

Backfill rebuilds the projection from the API alone, which is exactly the
right tool here: no deliveries exist for the period the App was uninstalled,
so replaying is not an option.

Then reconcile and confirm drift is zero.

## 5. If moving to a different organisation

The projection is keyed by `owner/repo`, so repositories under a new owner are
new entities. The old ones will linger.

1. Set `GITHUB_ORG` to the new organisation and redeploy.
2. Run a backfill.
3. Remove the stale projections for the old org. There is no bulk delete UI;
   the keys are under `console/state/github/repos/` and
   `console/state/github/prs/` in the bucket.

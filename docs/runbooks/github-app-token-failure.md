# Runbook: GitHub App token failure

**Symptom**: every GitHub read and write fails with a 401 or a message about
credentials, the rate limit badge shows an error, or webhook deliveries are
being rejected.

**Impact**: the console degrades to its stored projection. Nothing is lost;
nothing is current either.

## 1. Which credential broke

The console has two paths. Check which one is configured:

- `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` present means App mode.
- Otherwise `GH_TOKEN`, a personal access token, in fallback mode. Webhooks do
  not work in fallback mode.

## 2. App mode failures

**The installation was suspended or removed.** Check
`https://github.com/organizations/luminary-dev/settings/installations`. A
suspended installation stops all API access and all webhook delivery
immediately. Un-suspend it, then run a reconcile to catch up.

**The private key was deleted or rotated.** Generate a new key in the App
settings, update `GITHUB_APP_PRIVATE_KEY`, redeploy. GitHub allows two keys at
once, which is what makes rotation zero-downtime; see `secret-rotation.md`.

**The key is present but malformed.** The most common cause is newline
handling. The loader normalises literal `\n` sequences into real newlines, so
both forms work, but a key that lost its `-----BEGIN` header or gained extra
whitespace will not parse. Symptom is an error mentioning PEM or the sign
operation.

**Clock skew.** The App JWT carries `iat` and `exp`, and GitHub rejects a
token issued in the future. The JWT is backdated by 60 seconds to absorb
normal skew. Severe skew on the deployment host would break this, and would
also break other things.

**A permission is missing.** A 403 whose message says the resource is not
accessible by integration is not a token failure: the App lacks that
permission. Compare against the table in `docs/GITHUB-APP.md`, add the
permission in the App settings, and note that adding a permission requires the
org owner to approve the request on the installation.

## 3. Webhook rejection is a different failure

If the API works but GitHub's Recent Deliveries tab shows red entries with
401s, the problem is `GITHUB_WEBHOOK_SECRET`, not the App credentials. The
secret in the environment must match the one in the App settings byte for
byte. Fix the environment first, deploy, then update GitHub, because
deliveries signed with the old secret during the gap are rejected and retried.

## 4. Emergency: revoke everything

Suspend the installation. This stops all API access and all webhook delivery
immediately without deleting the App or its configuration. The console keeps
working on its stored projection.

## 5. Recovering afterwards

```
POST /api/github/deliveries  {"action":"reconcile"}
```

The drift count tells you how much was missed. If it is large, or if the
outage was longer than GitHub's own webhook retry window, run a backfill
instead, which rebuilds from the API and needs no deliveries at all.

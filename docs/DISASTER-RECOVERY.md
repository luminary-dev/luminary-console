# Disaster recovery

What is backed up, what is not, how long recovery takes, and how much data a
failure can cost. The procedure itself is `docs/runbooks/store-restore.md`.

## Objectives

| Measure | Value | Status |
| --- | --- | --- |
| RPO, client records | **Up to 7 days** | Measured from the backup schedule |
| RPO, GitHub projection | **0** | Rebuildable from the GitHub API at any time |
| RPO, generated documents | **0 for the current render**, up to 7 days for the pointer | Re-renderable from the record |
| RPO, client uploads and answer files | **Unbounded, they are not backed up** | See "What is not backed up" |
| RTO, single client record | About 15 minutes | **Estimated, not drilled** |
| RTO, full store | About 1 to 2 hours | **Estimated, not drilled** |

**The RTO figures are estimates.** The restore has never been performed. That
is the single most important gap in this document, and it is why the runbook
ends with a "Last drilled: never" line. An untested backup is a hypothesis.

## What is backed up

A weekly cron (Mondays 03:00 UTC, `/api/cron/backup`) builds a zip and emails
it to the studio address. It contains:

- `index.json`, the client index
- `clients/<slug>/record.json` for every client

The record is the aggregate root: identity, contacts, brief, document metadata
including the structured data each document was generated from, billing,
payments, change orders, designs, site, submissions, comments, uploads
metadata, tasks, notes, lifecycle stage, acceptance and signature.

If the email does not go out, the cron **fails the run** (a 502) rather than
reporting success, so a silently broken backup shows as a failed cron rather
than a green one.

## What is NOT backed up, and what that costs

This is the honest part.

| Not in the backup | Recoverable? | Cost if the bucket is lost |
| --- | --- | --- |
| Rendered documents (HTML and PDF) | **Yes.** `scripts/rerender.ts <slug>` rebuilds them from the structured data on the record, with no AI call | Asset URLs rotate, so the client portal flags the documents as "New" |
| GitHub projection (repos, PRs, runs, deployments, releases, alerts) | **Yes.** A backfill rebuilds it from the GitHub API | Minutes of API calls |
| Webhook delivery inbox | No, and it does not matter | Debugging history only |
| Activity log | **No** | The audit trail is lost. It is capped at 500 entries anyway |
| Session and revocation state | No, and it does not matter | Everyone signs in again |
| Push subscriptions | No | Each device re-enables alerts from the topbar |
| **Questionnaire answer files** | **No** | **Permanent loss of the client's own words** |
| **Client uploads** (brand assets, signed contracts, photos) | **No** | **Permanent loss of files the client sent us** |

The last two rows are the real exposure. They are client-supplied artefacts
that exist nowhere else, and the weekly backup deliberately excludes them
because they are large. Mitigations today:

- The answers PDF is emailed to the studio on submission, so the studio
  mailbox holds a copy of every submission.
- Upload notifications include a presigned link, valid 7 days, so a recent
  upload is recoverable from the mailbox for a week.

Neither is a backup. Closing this properly means either including assets in a
(much larger) backup, or enabling versioning and lifecycle rules on the R2
bucket, which is the cheaper answer and is not yet configured.

## Failure scenarios

**A client record is corrupted or deleted by mistake.** Restore that one
record from the latest zip. Runbook step 3. Cost: up to a week of changes to
that client.

**The index is corrupted.** No backup needed: the index is a denormalised copy
of fields that also live on each record, so it can be rebuilt by re-saving
each record. Runbook step 2. Since the LC-001 fix, a corrupt index throws
rather than silently reporting an empty client list, so this surfaces as an
error instead of as "all our clients vanished".

**The whole bucket is lost.** Restore every record, re-render the documents,
accept the loss of uploads and answer files, and re-seed the monotonic
document counter above every number ever issued so no document number is
reused. Runbook step 4. This is the scenario the RTO estimate of 1 to 2 hours
refers to.

**Cloudflare R2 is down but not lost.** Nothing to restore. The console
degrades: operators already signed in keep working (the session gate fails
open by design), nobody new can sign in (the OTP needs the store), and every
read fails. Wait it out.

**The deployment is lost.** The code is in GitHub and Vercel redeploys from
it. Environment variables are the thing to check: they live only in Vercel, so
losing the Vercel project means re-entering every secret. Keep an offline copy
of the variable NAMES (the list is in `README.md`); the values come from their
providers by rotation.

**A document number is reused.** An accounting hazard rather than an outage.
`console/counter.json` is monotonic and never lowers. If it is lost, seed it
above the highest number ever issued before creating any client
(`seedDocCounter`).

## Precedent

This is not hypothetical for this codebase. On 2026-08-06 the previous store
(Vercel Blob) was suspended for exceeding an operations quota, and **the data
did not survive**. The eco-mech client was rebuilt from known facts by
`scripts/recreate-ecomech.ts`, and the document counter was seeded to 60 so no
number could be reused. The migration to R2 removed the operation
amplification that caused it.

That event is the reason the backup exists at all. It is also the reason this
document is blunt about what the backup does not contain.

## What to do next, in priority order

1. **Drill the restore.** Restore last week's zip into a scratch bucket and
   walk the checks in the runbook. Until this happens the RTO is a guess.
2. **Enable R2 bucket versioning and a lifecycle policy.** This is the cheapest
   fix for the uploads and answer files gap, and it also covers accidental
   deletion of a rendered document.
3. **Back up more often than weekly.** A 7 day RPO on client records is long
   for a business whose records carry invoices and payments. Daily would cost
   almost nothing.
4. **Include the activity log** in the backup, so the audit trail survives.

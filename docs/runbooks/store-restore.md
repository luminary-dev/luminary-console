# Runbook: restoring the store

**When**: client records are missing, corrupt, or were deleted by mistake.

Read `docs/DISASTER-RECOVERY.md` for what the backup does and does not
contain, and for the RPO and RTO this procedure achieves.

## What you have to restore from

The weekly cron (Mondays 03:00 UTC) emails the studio a zip containing:

- `index.json`, the client index
- `clients/<slug>/record.json` for every client

**Not included, on purpose**: rendered documents (HTML and PDF), questionnaire
answer files, client uploads, design previews. Those are large, immutable, and
regenerable from the records. Uploads and answers are NOT regenerable, which
is the sharp edge of this design: see the honest limits in
`DISASTER-RECOVERY.md`.

## 1. Establish what is actually wrong

Do not restore first. A restore over a partially-good store loses whatever was
correct.

```
GET /api/clients          # what the index says
```

Then read a specific record directly through the console. Three cases:

- **The index is truncated or corrupt, records are fine.** This is the failure
  LC-001 was about, and `getIndex()` now throws rather than silently reporting
  an empty index, so the console shows an error instead of an empty list. Go
  to step 2.
- **A record is missing or corrupt.** Go to step 3.
- **Everything is gone.** Go to step 4.

## 2. Rebuild the index from the records

The index is a denormalised copy of fields that also live on each record, so
it can be rebuilt without a backup at all. From a local checkout with
`.env.local` populated:

```
npx tsx -e "
import('./lib/store').then(async (s) => {
  // Rebuild by re-saving each known record. saveClient rewrites the index
  // entry from the record, so this is self-healing.
  const slugs = ['eco-mech'];  // list every slug you know of
  for (const slug of slugs) {
    const c = await s.getClient(slug);
    if (c) { await s.saveClient(c); console.log('reindexed', slug); }
  }
});
"
```

If you do not know the slugs, list the bucket prefix `console/clients/` in the
Cloudflare dashboard: each folder name is a slug.

## 3. Restore one record

1. Open the most recent backup zip from the studio mailbox.
2. Extract `clients/<slug>/record.json`.
3. Review it before writing. Check `docNoBase`, `status`, `stage`, and the
   `billing` and `payments` arrays: this is the file that determines what the
   client is invoiced.
4. Write it back:

```
npx tsx -e "
import('fs').then(async (fs) => {
  const s = await import('./lib/store');
  const record = JSON.parse(fs.readFileSync('./record.json', 'utf8'));
  await s.saveClient(record);   // also repairs the index entry
  console.log('restored', record.slug);
});
"
```

5. Load the client page and check the documents still resolve. Asset URLs on
   the record point at immutable keys, so they survive a record restore as
   long as the assets themselves were not deleted.

## 4. Full restore

1. Restore `index.json` and every `record.json` as in step 3.
2. **Re-render the documents.** Records carry the structured data each
   document was generated from, so the renders can be rebuilt without any AI
   call:

   ```
   npx tsx scripts/rerender.ts <slug> [<slug>...]
   ```

   Naming slugs is important. With no arguments it re-renders every client,
   which rotates asset URLs and re-flags every document as "New" in the
   client's portal.
3. **Accept what is lost**: questionnaire answer PDFs, client uploads and
   design preview files are not in the backup. If the bucket itself survived
   and only the records were lost, those assets are still there and the
   restored records still point at them. If the bucket is gone, they are gone.
4. Check the document counter. `console/counter.json` is monotonic and stops
   document numbers being reused, which is an accounting hazard. If it was
   lost, seed it above every number ever issued:

   ```
   npx tsx -e "import('./lib/store').then(s => s.seedDocCounter(100))"
   ```

## 5. Confirm

- The dashboard lists every client.
- One client page renders end to end: documents, billing, payments, activity.
- The portal for one client loads and its published documents open.
- Money is right. Compare the outstanding balance against the invoices.

## Note

This procedure has NOT been drilled. Drilling it means restoring a backup into
a scratch bucket and walking the checks above, which is safe and takes about
half an hour. Until it is drilled, the RTO in `DISASTER-RECOVERY.md` is an
estimate rather than a measurement.

Last drilled: never.

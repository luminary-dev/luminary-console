// Re-render stored documents from their saved data through the current
// templates (no AI calls) — run after template changes so existing docs pick
// up the new shell. Covers client.docs (estimate, quotation, proposal,
// contract) AND billing[] (invoices, receipts, handover pack).
//
// A template-only re-render must not look like a new issue of the document:
//  - the "Issued" date is carried over from the render being replaced (read
//    from the stored HTML's meta row), not reset to today;
//  - updatedAt itself is restored afterwards, so the portal does not flag
//    every document "New" and the next re-render derives the same date;
//  - the superseded HTML/PDF objects are deleted, since putAsset writes a
//    fresh key each time. History versions are left untouched.
//
// Usage: vercel env pull && npx tsx scripts/rerender.ts [--dry-run] [<slug>…]
// With no slugs it does every client — name the slugs when that isn't what
// you want. --dry-run lists what would be re-rendered and changes nothing.
import { config } from "dotenv";
config({ path: ".env.local" });

/** The date the stored render actually shows in its "Issued" (or the
 *  contract's "Date") meta row. updatedAt is NOT a substitute: it moves on
 *  publish and other status changes without a re-render, so deriving from it
 *  re-dates documents the client already holds. Falls back to updatedAt only
 *  when the stored HTML cannot be read. */
async function shownIssued(htmlUrl: string, updatedAt: string): Promise<string | undefined> {
  const { fetchAsset } = await import("../lib/store");
  try {
    const html = await (await fetchAsset(htmlUrl)).text();
    const m = html.match(/<span>(?:Issued|Date)<\/span><span[^>]*>([^<]+)<\/span>/);
    if (m?.[1]) return m[1].trim();
  } catch {
    // fall through to the derived date
  }
  const ms = Date.parse(updatedAt);
  return Number.isFinite(ms)
    ? new Date(ms).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Colombo" })
    : undefined;
}

async function main() {
  const { getIndex, getClient, saveClient, deleteAssets } = await import("../lib/store");
  const { saveDoc, saveBillingDoc } = await import("../lib/pipeline");
  const { shutdownPdfBrowser } = await import("../lib/pdf");
  const { DOC_LABELS } = await import("../lib/types");

  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const only = new Set(args.filter((a) => !a.startsWith("--")));
  const index = (await getIndex()).filter((e) => only.size === 0 || only.has(e.slug));
  if (only.size === 0) console.log(`No slugs given — ${dryRun ? "listing" : "re-rendering"} ALL clients.`);

  let rendered = 0;
  for (const entry of index) {
    const client = await getClient(entry.slug);
    if (!client) continue;
    const superseded: string[] = [];

    for (const meta of Object.values(client.docs)) {
      if (!meta) continue;
      const issued = await shownIssued(meta.htmlUrl, meta.updatedAt);
      console.log(`${entry.slug}: ${DOC_LABELS[meta.type]} ${meta.no} [${meta.status}] issued ${issued ?? "today"}`);
      if (dryRun) continue;
      const { htmlUrl, pdfUrl, updatedAt } = meta;
      const next = await saveDoc(client, meta.type, meta.data, meta.status, issued);
      next.updatedAt = updatedAt;
      superseded.push(htmlUrl, pdfUrl);
      rendered++;
    }

    for (const doc of client.billing ?? []) {
      const issued = await shownIssued(doc.htmlUrl, doc.updatedAt);
      console.log(`${entry.slug}: ${doc.kind} ${doc.no} [${doc.status}] issued ${issued ?? "today"}`);
      if (dryRun) continue;
      const { htmlUrl, pdfUrl, updatedAt } = doc;
      await saveBillingDoc(client, doc.kind, doc.stage, doc.data, doc.status, doc.slug, issued);
      doc.updatedAt = updatedAt;
      superseded.push(htmlUrl, pdfUrl);
      rendered++;
    }

    if (dryRun) continue;
    await saveClient(client);
    // Only after the record points at the new objects is it safe to drop the old ones.
    await deleteAssets(superseded.filter(Boolean));
  }

  await shutdownPdfBrowser();
  console.log(dryRun ? "dry run — nothing changed" : `done — ${rendered} document(s) re-rendered`);
}

main().catch(async (e) => {
  console.error(e);
  try {
    const { shutdownPdfBrowser } = await import("../lib/pdf");
    await shutdownPdfBrowser();
  } catch {
    // nothing left to close
  }
  process.exit(1);
});

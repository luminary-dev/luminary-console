// Re-render stored documents from their saved data through the current
// templates (no AI calls) — run after template changes so existing docs pick
// up the new shell.
//
// Usage: vercel env pull && npx tsx scripts/rerender.ts [<slug>…]
// With no slugs it does every client, which rewrites live clients' published
// assets (new URLs, new updatedAt — so the portal flags them "New"). Name the
// slugs when that isn't what you want.
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { getIndex, getClient, saveClient } = await import("../lib/store");
  const { saveDoc } = await import("../lib/pipeline");
  const { DOC_LABELS } = await import("../lib/types");

  const only = new Set(process.argv.slice(2));
  const index = (await getIndex()).filter((e) => only.size === 0 || only.has(e.slug));
  if (only.size === 0) console.log("No slugs given — re-rendering ALL clients.");

  for (const entry of index) {
    const client = await getClient(entry.slug);
    if (!client) continue;
    for (const [type, meta] of Object.entries(client.docs)) {
      if (!meta) continue;
      await saveDoc(client, meta.type, meta.data, meta.status);
      console.log(`${entry.slug}: re-rendered ${DOC_LABELS[meta.type]} (${meta.no}) [${meta.status}]`);
      void type;
    }
    await saveClient(client);
  }
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

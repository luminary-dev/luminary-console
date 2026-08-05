// Re-render every stored document from its saved data through the current
// templates (no AI calls) — run after template changes so existing docs pick
// up the new shell. Usage: vercel env pull && npx tsx scripts/rerender.ts
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { getIndex, getClient, saveClient } = await import("../lib/store");
  const { saveDoc } = await import("../lib/pipeline");
  const { DOC_LABELS } = await import("../lib/types");

  for (const entry of await getIndex()) {
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

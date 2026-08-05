// Delete client(s) completely: all blobs (record, docs, answers) + index
// entry. DNS/domain cleanup is printed as commands (destructive, so manual).
// Usage: npx tsx scripts/delete-client.ts <slug> [<slug>…]
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const slugs = process.argv.slice(2);
  if (slugs.length === 0) {
    console.error("Usage: npx tsx scripts/delete-client.ts <slug> [<slug>…]");
    process.exit(1);
  }
  const { list, del, put } = await import("@vercel/blob");

  for (const slug of slugs) {
    const { blobs } = await list({ prefix: `console/clients/${slug}/`, limit: 1000 });
    if (blobs.length) {
      await del(blobs.map((b) => b.url));
    }
    console.log(`${slug}: deleted ${blobs.length} blobs`);
  }

  // Rewrite the index without the deleted slugs.
  const { blobs: indexBlobs } = await list({ prefix: "console/index", limit: 100 });
  const latest = indexBlobs.sort((a, b) => +new Date(b.uploadedAt) - +new Date(a.uploadedAt))[0];
  if (latest) {
    const index = (await (await fetch(latest.url, { cache: "no-store" })).json()) as { slug: string }[];
    const filtered = index.filter((e) => !slugs.includes(e.slug));
    await put("console/index.json", JSON.stringify(filtered), {
      access: "public",
      addRandomSuffix: true,
      contentType: "application/json",
    });
    await del(indexBlobs.map((b) => b.url));
    console.log(`index: ${index.length} → ${filtered.length} entries`);
  }
  console.log("Blob cleanup done. Also remove per-client DNS + domains if desired.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

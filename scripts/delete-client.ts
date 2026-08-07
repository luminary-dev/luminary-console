// Delete client(s) completely: every object under their R2 prefix (record,
// docs, billing, answers, attachments) + the index entry. DNS/domain cleanup
// is printed as commands (destructive, so manual).
// Usage: npx tsx scripts/delete-client.ts <slug> [<slug>…]
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const slugs = process.argv.slice(2);
  if (slugs.length === 0) {
    console.error("Usage: npx tsx scripts/delete-client.ts <slug> [<slug>…]");
    process.exit(1);
  }
  if (slugs.includes("eco-mech")) {
    console.error("Refusing to delete eco-mech — that is a real client record.");
    process.exit(1);
  }
  const { deleteClient, getIndex } = await import("../lib/store");

  for (const slug of slugs) {
    const objects = await deleteClient(slug);
    console.log(`${slug}: deleted ${objects} objects`);
  }
  console.log(`index: ${(await getIndex()).length} entries remain`);
  console.log("R2 cleanup done. Also remove per-client DNS + domains if desired.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

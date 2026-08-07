// Rebuild the eco-mech client record after the Vercel Blob store was lost.
//
// The old data is unrecoverable, so this recreates it from the facts we still
// hold and runs the NORMAL creation pipeline (runStage1) — the estimate is
// drafted and rendered, the subdomain is ensured, the studio gets its email —
// rather than hand-writing a record the rest of the app would treat as odd.
//
// Two things are then corrected, because a fresh pipeline run can't know them:
//   1. docNoBase is forced back to "0043" (the number this client was issued)
//      and the estimate is re-rendered so the printed number matches. This is
//      a template re-render off the stored data — no second drafting call.
//   2. The monotonic doc counter is seeded to 60, comfortably above every
//      number ever issued from the lost store, so nothing is ever reused.
//
// IDEMPOTENT: it refuses to run if an eco-mech record or index entry already
// exists. Deleting the record first is a deliberate act, not something this
// script will do for you.
// Usage: npx tsx scripts/recreate-ecomech.ts
import { config } from "dotenv";
config({ path: ".env.local" });

const SLUG = "eco-mech";
const DOC_NO_BASE = "0043";
/** Above every number the lost store ever issued — doc numbers never repeat. */
const COUNTER_FLOOR = 60;

async function main() {
  const { getClient, getIndex, saveClient, seedDocCounter, deleteAssets } = await import("../lib/store");
  const { runStage1, saveDoc } = await import("../lib/pipeline");

  if (await getClient(SLUG)) {
    console.error(`Refusing to run: a "${SLUG}" record already exists. Nothing was changed.`);
    process.exit(1);
  }
  if ((await getIndex()).some((e) => e.slug === SLUG)) {
    console.error(`Refusing to run: "${SLUG}" is already in the client index. Nothing was changed.`);
    process.exit(1);
  }

  console.log("Running stage 1 (drafting the estimate + questions, ensuring the subdomain)…");
  const client = await runStage1({
    slug: SLUG,
    company: "Ecomech Engineering Lanka (Pvt) Ltd.",
    reg: "PV110496",
    address: "No. 39-5/1, Inner Fairline Road, Dehiwala, Sri Lanka",
    email: "ecomech.lk@samakej.com.my",
    phone: "+94 77 4680274",
    brief:
      "Ecomech Engineering Lanka is an MEP (mechanical, electrical & plumbing) engineering " +
      "firm in Sri Lanka that bids for hotel tenders and needs a credible web presence to " +
      "put in front of tender panels and prospective clients. They want a single landing " +
      "page covering who they are, their MEP capabilities and completed projects, with an " +
      "enquiry form. Budget: UX & design LKR 5,000–10,000; development LKR 30,000–40,000. " +
      "Cost scales with page count: 2–3 pages +5,000–7,000/page, 4–6 pages +3,000–5,000/page " +
      "beyond 3, 7+ pages a custom quote.",
  });

  // ——— restore the original document number ———
  if (client.docNoBase !== DOC_NO_BASE) {
    const issued = client.docNoBase;
    const superseded = Object.values(client.docs).flatMap((m) => (m ? [m.htmlUrl, m.pdfUrl] : []));
    client.docNoBase = DOC_NO_BASE;
    for (const meta of Object.values(client.docs)) {
      if (meta) await saveDoc(client, meta.type, meta.data, meta.status);
    }
    await saveClient(client);
    await deleteAssets(superseded);
    console.log(`Renumbered ${issued} → ${DOC_NO_BASE} and re-rendered ${Object.keys(client.docs).length} document(s).`);
    console.log(`Note: the "New client set up" email quotes LUM-EST-${issued} — the record and the live document are LUM-EST-${DOC_NO_BASE}.`);
  }

  const counter = await seedDocCounter(COUNTER_FLOOR);

  console.log(
    JSON.stringify(
      {
        slug: client.slug,
        company: client.company,
        docNoBase: client.docNoBase,
        projectLabel: client.projectLabel,
        dnsStatus: client.dnsStatus,
        docs: Object.keys(client.docs),
        extraQuestions: client.extraQuestions.length,
        docCounter: counter,
      },
      null,
      2,
    ),
  );
  console.log(`\nDone. Next doc number issued will be ${String(counter + 1).padStart(4, "0")}.`);
  console.log(`Check https://${client.domain}/estimate and https://${client.domain}/questionnaire.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

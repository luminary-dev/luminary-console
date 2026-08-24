// QA suite — the studio notification surface, end to end. Walks one dummy
// client through EVERY event that pushes a notice to the admins' phones:
// the client-portal actions (submit, accept, question, upload, design pick,
// design feedback, contract signing) and the operator actions (doc publish/
// unpublish, emailing docs, payments, stage changes).
//
// Telegram is muted (house QA convention) but Web Push deliberately is NOT:
// a subscribed device receiving the full burst is exactly what this suite
// exists to demonstrate. Expect ~13 notifications on subscribed phones.
//
//   npx tsx --env-file=.env.local scripts/tests/suite-notify.ts
import { callRoute } from "../invoke";
import { test, expect, note, finish } from "./harness";

const SLUG = "qa-suite-notify";
const COMPANY = "QA Notify Co";
// Distinct forwarded IPs so the portal rate limiter treats each action as a
// separate visitor, like the accept tests in suite-client.
let ipN = 0;
const ip = () => ({ "x-forwarded-for": `10.7.7.${++ipN}` });

type Rec = Record<string, any>;

async function getRecord(): Promise<Rec | null> {
  const { getClient } = await import("../../lib/store");
  return (await getClient(SLUG)) as Rec | null;
}

async function teardown(label: string): Promise<void> {
  if (!(await getRecord())) return;
  const { deleteClient } = await import("../../lib/store");
  const { removeClientDomain } = await import("../../lib/domains");
  const notes = await removeClientDomain(SLUG).catch((e) => [`domain removal failed: ${e}`]);
  const objects = await deleteClient(SLUG);
  note(`${label}: fixture removed (${objects} objects; ${JSON.stringify(notes)})`);
}

async function main() {
  // Mute the group chat for dummy runs; push stays live on purpose.
  process.env.TELEGRAM_BOT_TOKEN = "";

  await teardown("pre-clean").catch(() => {});

  console.log("Notification surface suite\n");
  note("every ✓ marked (push) should land as a notification on subscribed phones");

  await test("create the fixture client (no notice — creation is silent)", async () => {
    const r = await callRoute("POST", "/api/clients", {
      company: COMPANY,
      slug: SLUG,
      email: process.env.STUDIO_EMAIL || "support@luminary-dev.xyz",
      contactName: "QA Contact",
      brief:
        "Dummy client for the notification QA suite. Landing page project, " +
        "10-20k LKR. Never a real engagement; deleted in teardown.",
    });
    expect(r.status === 200, `got ${r.status}: ${r.text.slice(0, 200)}`);
  });

  await test("questionnaire submitted (push)", async () => {
    const rec = (await getRecord())!;
    const { buildSections } = await import("../../lib/questions");
    const answers: Rec = {};
    for (const s of buildSections(rec as any)) {
      for (const f of s.fields as Rec[]) {
        if (f.type === "upload") continue;
        if (f.type === "checks") answers[f.id] = [f.options?.[0] ?? "QA"];
        else if (f.id === "contactName") answers[f.id] = "QA Client";
        else if (f.id === "contactEmail") answers[f.id] = "support@luminary-dev.xyz";
        else answers[f.id] = "QA test answer.";
      }
    }
    const r = await callRoute("POST", `/c/${SLUG}/submit`, { answers, sendCopy: false }, undefined, ip());
    expect(r.status === 200, `got ${r.status}: ${r.text.slice(0, 200)}`);
  });

  await test("stage-2 drafts ready (prerequisite, no notice)", async () => {
    const deadline = Date.now() + 180_000;
    let rec = (await getRecord())!;
    while (!rec.docs?.quotation && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5_000));
      rec = (await getRecord())!;
    }
    if (!rec.docs?.quotation) {
      note("after() didn't fire here — using retry-stage2");
      const r = await callRoute("POST", `/api/clients/${SLUG}/docs/quotation`, { action: "retry-stage2" });
      expect(r.status === 200, `retry-stage2 → ${r.status}: ${r.text.slice(0, 200)}`);
      rec = (await getRecord())!;
    }
    expect(rec.docs?.quotation && rec.docs?.contract, "stage-2 docs missing");
  });

  await test("quotation published (push)", async () => {
    const r = await callRoute("POST", `/api/clients/${SLUG}/docs/quotation`, { action: "publish" });
    expect(r.status === 200, `got ${r.status}: ${r.text}`);
  });

  await test("quotation accepted by the client (push)", async () => {
    const r = await callRoute("POST", `/c/${SLUG}/accept`, { name: "QA Client" }, undefined, ip());
    expect(r.status === 200 && r.json?.name === "QA Client", `got ${r.status}: ${r.text}`);
  });

  await test("question asked from the portal (push)", async () => {
    const r = await callRoute(
      "POST",
      `/c/${SLUG}/comment`,
      { doc: "quotation", by: "QA Client", text: "Does the quote include hosting for the first year?" },
      undefined,
      ip(),
    );
    expect(r.status === 200, `got ${r.status}: ${r.text}`);
  });

  await test("file uploaded from the portal (push)", async () => {
    const bytes = Buffer.from("%PDF-1.4\n% QA dummy upload\n%%EOF\n");
    const up = await callRoute(
      "POST",
      `/c/${SLUG}/upload`,
      { name: "qa-brand-guide.pdf", contentType: "application/pdf", size: bytes.length },
      undefined,
      ip(),
    );
    expect(up.status === 200 && up.json?.url && up.json?.key, `presign: ${up.status}: ${up.text}`);
    const put = await fetch(String(up.json!.url), {
      method: "PUT",
      headers: { "Content-Type": "application/pdf" },
      body: bytes,
    });
    expect(put.ok, `R2 PUT failed: ${put.status}`);
    const r = await callRoute(
      "POST",
      `/c/${SLUG}/files`,
      { url: `/api/asset/${up.json!.key}`, name: "qa-brand-guide.pdf", size: bytes.length, by: "QA Client" },
      undefined,
      ip(),
    );
    expect(r.status === 200, `record: ${r.status}: ${r.text}`);
  });

  await test("design uploaded + published (prerequisite, no notice)", async () => {
    const html = "<!doctype html><html><head><title>QA Concept</title></head><body><h1>QA design concept</h1></body></html>";
    const up = await callRoute("POST", `/api/clients/${SLUG}/designs`, { title: "QA Concept A", html });
    expect(up.status === 200, `create: ${up.status}: ${up.text}`);
    const pub = await callRoute("POST", `/api/clients/${SLUG}/designs/1`, { action: "publish" });
    expect(pub.status === 200, `publish: ${pub.status}: ${pub.text}`);
  });

  await test("design selected by the client (push)", async () => {
    const r = await callRoute("POST", `/c/${SLUG}/select-design`, { id: "1", by: "QA Client" }, undefined, ip());
    expect(r.status === 200, `got ${r.status}: ${r.text}`);
  });

  await test("design changes requested by the client (push)", async () => {
    const r = await callRoute(
      "POST",
      `/c/${SLUG}/design-feedback`,
      { id: "1", by: "QA Client", text: "Please try the hero section with the dark palette." },
      undefined,
      ip(),
    );
    expect(r.status === 200, `got ${r.status}: ${r.text}`);
  });

  await test("contract published (push)", async () => {
    const r = await callRoute("POST", `/api/clients/${SLUG}/docs/contract`, { action: "publish" });
    expect(r.status === 200, `got ${r.status}: ${r.text}`);
  });

  await test("agreement signed by the client (push)", async () => {
    const r = await callRoute("POST", `/c/${SLUG}/sign-contract`, { name: "QA Client" }, undefined, ip());
    expect(r.status === 200, `got ${r.status}: ${r.text}`);
  });

  await test("payment recorded (push)", async () => {
    const r = await callRoute("POST", `/api/clients/${SLUG}/payments`, {
      action: "add",
      amount: 25_000,
      method: "bank transfer",
      note: "QA dummy payment",
    });
    expect(r.status === 200, `got ${r.status}: ${r.text}`);
  });

  await test("documents emailed to the client (push)", async () => {
    const r = await callRoute("POST", `/api/clients/${SLUG}/send`, { docs: ["quotation"] });
    expect(r.status === 200, `got ${r.status}: ${r.text.slice(0, 200)}`);
  });

  await test("stage changed (push)", async () => {
    const r = await callRoute("POST", `/api/clients/${SLUG}/stage`, { stage: "development" });
    expect(r.status === 200, `got ${r.status}: ${r.text}`);
  });

  await test("quotation unpublished (push)", async () => {
    const r = await callRoute("POST", `/api/clients/${SLUG}/docs/quotation`, { action: "unpublish" });
    expect(r.status === 200, `got ${r.status}: ${r.text}`);
  });

  note("not exercised here: site deploy (creates a real repo + Vercel project;");
  note("its notice shares the studioNotice path proven above) and the daily");
  note("digest cron (sendPush call verified by suite-ops' cron auth checks).");

  await teardown("teardown");
  await test("fixture fully removed", async () => {
    expect((await getRecord()) === null, "record still present after teardown");
  });

  finish("Notification surface suite");
}

main().catch(async (e) => {
  console.error(e);
  await teardown("crash-clean").catch(() => {});
  process.exit(1);
});

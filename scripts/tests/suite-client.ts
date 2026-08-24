// QA suite — the full client lifecycle with dummy data: create (estimate +
// questionnaire + PDFs + subdomain), submit answers, draft stage-2 documents,
// then exercise every document action, billing, payments, stage, notes,
// tasks. All emails/Telegram pings go to the studio's own channels and are
// clearly labelled TEST.
//
// The password-guarded deletion endpoint is tested for rejection only (403):
// the happy path needs a real operator password, which this suite must not
// hold. The fixture is torn down through the same internals the endpoint
// uses (removeClientDomain + deleteClient), so nothing test-created remains.
//
//   npx tsx --env-file=.env.local scripts/tests/suite-client.ts
import { callRoute } from "../invoke";
import { test, expect, note, finish } from "./harness";

const SLUG = "qa-suite-client";
const COMPANY = "QA Suite Testing (TEST)";

type Rec = Record<string, any>;

const getRecord = async (): Promise<Rec | null> => {
  const r = await callRoute("GET", `/api/clients/${SLUG}`);
  return r.status === 200 ? (r.json as Rec) : null;
};

async function teardown(label: string): Promise<void> {
  if (!(await getRecord())) return;
  const { deleteClient } = await import("../../lib/store");
  const { removeClientDomain } = await import("../../lib/domains");
  const notes = await removeClientDomain(SLUG).catch((e) => [`domain removal failed: ${e}`]);
  const objects = await deleteClient(SLUG);
  note(`${label}: fixture removed (${objects} objects; ${JSON.stringify(notes)})`);
}

async function main() {
  console.log("Client lifecycle suite\n");
  await teardown("pre-clean"); // leftovers from a crashed previous run

  await test("rejects a client without company/brief (400)", async () => {
    const r = await callRoute("POST", "/api/clients", { company: "", brief: "" });
    expect(r.status === 400, `got ${r.status}: ${r.text}`);
  });

  await test("rejects a reserved slug (400)", async () => {
    const r = await callRoute("POST", "/api/clients", {
      company: "X Co",
      slug: "console",
      brief: "A landing page for 45k LKR.",
    });
    expect(r.status === 400, `got ${r.status}: ${r.text}`);
  });

  await test("rejects a slug ending in a hyphen (400)", async () => {
    const r = await callRoute("POST", "/api/clients", {
      company: "X Co",
      slug: "bad-",
      brief: "A landing page for 45k LKR.",
    });
    expect(r.status === 400, `got ${r.status}: ${r.text}`);
  });

  await test("creates the client — estimate, questionnaire, PDFs, subdomain", async () => {
    const r = await callRoute("POST", "/api/clients", {
      company: COMPANY,
      slug: SLUG,
      brief:
        "TEST FIXTURE — a single landing page for a small Colombo bakery, fixed budget LKR 65,000. This is dummy data created by the automated QA suite; documents are never sent to a real client.",
      contactName: "QA Tester",
      email: "support@luminary-dev.xyz",
      phone: "+94 77 16 18 093",
      address: "1 Test Lane, Colombo",
    });
    expect(r.status === 200, `got ${r.status}: ${r.text.slice(0, 200)}`);
    const rec = await getRecord();
    expect(rec, "record not stored");
    expect(rec.docs?.estimate?.pdfUrl, "estimate not generated");
    expect(rec.docs?.estimate?.no, "estimate has no doc number");
  });

  await test("estimate PDF asset is a real PDF", async () => {
    const rec = (await getRecord())!;
    const { fetchAsset } = await import("../../lib/store");
    const res = await fetchAsset(rec.docs.estimate.pdfUrl);
    expect(res.ok, `asset fetch ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 4).toString() === "%PDF", "not a PDF");
    expect(buf.length > 10_000, `PDF suspiciously small: ${buf.length}B`);
  });

  await test("409 on a duplicate slug", async () => {
    const r = await callRoute("POST", "/api/clients", {
      company: COMPANY,
      slug: SLUG,
      brief: "Duplicate attempt.",
    });
    expect(r.status === 409, `got ${r.status}: ${r.text}`);
  });

  await test("questionnaire submission stores answers (+ answers PDF)", async () => {
    const rec = (await getRecord())!;
    const { buildSections } = await import("../../lib/questions");
    const answers: Rec = {};
    for (const s of buildSections(rec as any)) {
      for (const f of s.fields as Rec[]) {
        if (f.type === "upload") continue;
        if (f.type === "checks") answers[f.id] = [f.options?.[0] ?? "QA"];
        else if (f.id === "contactName") answers[f.id] = "QA Tester";
        else if (f.id === "contactEmail") answers[f.id] = "support@luminary-dev.xyz";
        else answers[f.id] = "QA test answer.";
      }
    }
    const r = await callRoute("POST", `/c/${SLUG}/submit`, { answers, sendCopy: false });
    expect(r.status === 200, `got ${r.status}: ${r.text.slice(0, 200)}`);
    const after = (await getRecord())!;
    expect(after.answersUrl, "answers not stored");
    expect(after.answersPdfUrl, "answers PDF not stored");
  });

  await test("stage-2 documents draft (quotation, proposal, contract)", async () => {
    // The submit route drafts stage 2 in an after() hook (or its floating
    // fallback outside the Next runtime) — give the draft time to land, then
    // drive it through the console's own retry action (the same recovery the
    // UI offers) only if it truly never fired.
    const deadline = Date.now() + 180_000;
    let rec = (await getRecord())!;
    while (!rec.docs?.quotation && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5_000));
      rec = (await getRecord())!;
    }
    if (!rec.docs?.quotation) {
      note("after() didn't fire here — using retry-stage2");
      const r = await callRoute("POST", `/api/clients/${SLUG}/docs/quotation`, {
        action: "retry-stage2",
      });
      expect(r.status === 200, `retry-stage2 → ${r.status}: ${r.text.slice(0, 200)}`);
      rec = (await getRecord())!;
    }
    for (const t of ["quotation", "proposal", "contract"]) {
      expect(rec.docs?.[t]?.pdfUrl, `${t} missing`);
      expect(rec.docs?.[t]?.status === "draft", `${t} not a draft`);
    }
  });

  await test("second submission is recorded but never re-drafts documents", async () => {
    const rec = (await getRecord())!;
    const before = rec.docs.quotation.no;
    const r = await callRoute(
      "POST",
      `/c/${SLUG}/submit`,
      { answers: { contactName: "QA Tester 2", describe: "Second QA submission." }, sendCopy: false },
      undefined,
      { "x-forwarded-for": "10.9.9.2" },
    );
    // The tailored schema may mark extra fields required — a 400 here is the
    // schema doing its job; a 200 must land in submissions history.
    if (r.status === 200) {
      const after = (await getRecord())!;
      expect((after.submissions ?? []).length >= 2, "second submission not recorded");
      expect(after.docs.quotation.no === before, "documents were re-drafted");
    } else {
      expect(r.status === 400, `got ${r.status}: ${r.text.slice(0, 160)}`);
      note("schema required more fields — validation path exercised instead");
    }
  });

  await test("unknown doc type and unknown action are 400s", async () => {
    const a = await callRoute("POST", `/api/clients/${SLUG}/docs/blueprint`, { action: "publish" });
    expect(a.status === 400, `doc type: got ${a.status}`);
    const b = await callRoute("POST", `/api/clients/${SLUG}/docs/quotation`, { action: "frobnicate" });
    expect(b.status === 400, `action: got ${b.status}`);
  });

  await test("publishing the quotation advances the stage to quoted", async () => {
    const r = await callRoute("POST", `/api/clients/${SLUG}/docs/quotation`, { action: "publish" });
    expect(r.status === 200, `got ${r.status}: ${r.text}`);
    const rec = (await getRecord())!;
    expect(rec.docs.quotation.status === "published", "not published");
    expect(rec.stage === "quoted", `stage: ${rec.stage}`);
  });

  await test("public doc page serves the published quotation, 404s a draft", async () => {
    const pub = await callRoute("GET", `/c/${SLUG}/quotation`);
    expect(pub.status === 200, `published: got ${pub.status}`);
    expect(pub.headers["content-type"]?.includes("text/html"), "not HTML");
    expect(pub.text.includes(COMPANY.split(" (")[0]), "company missing from page");
    const draft = await callRoute("GET", `/c/${SLUG}/proposal`);
    expect(draft.status === 404, `draft: got ${draft.status}`);
    const missing = await callRoute("GET", `/c/${SLUG}/receipt`);
    expect(missing.status === 404, `missing doc: got ${missing.status}`);
  });

  await test("acceptance requires a name, then stamps and advances the stage", async () => {
    const noName = await callRoute("POST", `/c/${SLUG}/accept`, { name: "" }, undefined, {
      "x-forwarded-for": "10.9.9.3",
    });
    expect(noName.status === 400, `no-name: got ${noName.status}`);
    const honey = await callRoute(
      "POST",
      `/c/${SLUG}/accept`,
      { name: "Bot", company: "spam co" },
      undefined,
      { "x-forwarded-for": "10.9.9.4" },
    );
    expect(honey.status === 200 && honey.json?.ok === true, "honeypot should pretend success");
    expect(!(await getRecord())!.acceptance, "honeypot must not accept");
    const ok = await callRoute("POST", `/c/${SLUG}/accept`, { name: "QA Acceptor" }, undefined, {
      "x-forwarded-for": "10.9.9.5",
    });
    expect(ok.status === 200 && ok.json?.name === "QA Acceptor", `accept: ${ok.text}`);
    const rec = (await getRecord())!;
    expect(rec.acceptance?.name === "QA Acceptor", "acceptance not stored");
    expect(rec.stage === "accepted", `stage: ${rec.stage}`);
    const again = await callRoute("POST", `/c/${SLUG}/accept`, { name: "Other" }, undefined, {
      "x-forwarded-for": "10.9.9.6",
    });
    expect(again.json?.already === true, "second accept not idempotent");
  });

  await test("retry-stage2 refuses while the quotation is published (409)", async () => {
    const r = await callRoute("POST", `/api/clients/${SLUG}/docs/quotation`, { action: "retry-stage2" });
    expect(r.status === 409, `got ${r.status}: ${r.text}`);
  });

  await test("deleting a published document is refused (400)", async () => {
    const r = await callRoute("POST", `/api/clients/${SLUG}/docs/quotation`, { action: "delete" });
    expect(r.status === 400, `got ${r.status}: ${r.text}`);
  });

  await test("regenerate revises the quotation and archives the old version", async () => {
    const r = await callRoute("POST", `/api/clients/${SLUG}/docs/quotation`, {
      action: "regenerate",
      instructions: "Add a line item note that this is a QA test revision. Keep the total unchanged.",
      cascade: false,
    });
    expect(r.status === 200, `got ${r.status}: ${r.text.slice(0, 200)}`);
    const rec = (await getRecord())!;
    expect((rec.docs.quotation.history ?? []).length >= 1, "old version not archived");
    expect(rec.docs.quotation.status === "published", "status not preserved");
  });

  await test("regenerate without instructions is a 400", async () => {
    const r = await callRoute("POST", `/api/clients/${SLUG}/docs/proposal`, { action: "regenerate" });
    expect(r.status === 400, `got ${r.status}: ${r.text}`);
  });

  await test("proposal publish → unpublish round trip", async () => {
    const a = await callRoute("POST", `/api/clients/${SLUG}/docs/proposal`, { action: "publish" });
    expect(a.status === 200 && a.json?.status === "published", `publish: ${a.text}`);
    const b = await callRoute("POST", `/api/clients/${SLUG}/docs/proposal`, { action: "unpublish" });
    expect(b.status === 200 && b.json?.status === "draft", `unpublish: ${b.text}`);
  });

  await test("contract e-signing: 404 unpublished, then stamps a signature", async () => {
    const early = await callRoute("POST", `/c/${SLUG}/sign-contract`, { name: "QA Signer" }, undefined, {
      "x-forwarded-for": "10.9.9.7",
    });
    expect(early.status === 404, `unpublished sign: got ${early.status}`);
    await callRoute("POST", `/api/clients/${SLUG}/docs/contract`, { action: "publish" });
    const ok = await callRoute("POST", `/c/${SLUG}/sign-contract`, { name: "QA Signer" }, undefined, {
      "x-forwarded-for": "10.9.9.8",
    });
    expect(ok.status === 200 && ok.json?.name === "QA Signer", `sign: ${ok.text}`);
    expect((await getRecord())!.contractSignature?.name === "QA Signer", "signature not stored");
    const again = await callRoute("POST", `/c/${SLUG}/sign-contract`, { name: "Other" }, undefined, {
      "x-forwarded-for": "10.9.9.9",
    });
    expect(again.json?.already === true, "second sign not idempotent");
  });

  await test("contract can be deleted once unpublished", async () => {
    await callRoute("POST", `/api/clients/${SLUG}/docs/contract`, { action: "unpublish" });
    const r = await callRoute("POST", `/api/clients/${SLUG}/docs/contract`, { action: "delete" });
    expect(r.status === 200, `got ${r.status}: ${r.text}`);
    const rec = (await getRecord())!;
    expect(!rec.docs.contract, "contract still present");
  });

  await test("docs route 404s a document that was never generated", async () => {
    const r = await callRoute("POST", `/api/clients/${SLUG}/docs/invoice`, { action: "publish" });
    expect(r.status === 404, `got ${r.status}: ${r.text}`);
  });

  await test("billing: 'other' invoice without instructions is a 400", async () => {
    const r = await callRoute("POST", `/api/clients/${SLUG}/billing`, {
      action: "generate",
      kind: "invoice",
      stage: "other",
    });
    expect(r.status === 400, `got ${r.status}: ${r.text}`);
  });

  let invoiceSlug = "";
  await test("billing: design-approval invoice generates with a due date", async () => {
    const r = await callRoute("POST", `/api/clients/${SLUG}/billing`, {
      action: "generate",
      kind: "invoice",
      stage: "progress",
    });
    expect(r.status === 200, `got ${r.status}: ${r.text.slice(0, 200)}`);
    const rec = (await getRecord())!;
    const inv = (rec.billing ?? []).find((b: Rec) => b.kind === "invoice");
    expect(inv, "invoice missing from record");
    invoiceSlug = inv.slug;
    const days = (Date.parse(inv.dueOn) - Date.now()) / 86_400_000;
    expect(days > 6 && days < 8, `dueOn not ~7 days out (${days.toFixed(1)}d)`);
    const pub = await callRoute("POST", `/api/clients/${SLUG}/billing`, {
      action: "publish",
      doc: invoiceSlug,
    });
    expect(pub.status === 200, `publish: ${pub.text}`);
  });

  await test("send: emails the published documents to the client", async () => {
    const bad = await callRoute("POST", `/api/clients/${SLUG}/send`, { docs: ["nonexistent"] });
    expect(bad.status === 400, `unknown doc: got ${bad.status}`);
    const r = await callRoute("POST", `/api/clients/${SLUG}/send`, { docs: ["quotation"] });
    expect(r.status === 200, `got ${r.status}: ${r.text}`);
    expect(r.json?.sentTo === "support@luminary-dev.xyz", `sentTo: ${r.json?.sentTo}`);
    const rec = (await getRecord())!;
    expect((rec.emailLog ?? []).length >= 1, "emailLog not recorded");
  });

  await test("change orders: free-tier default, override, and removal", async () => {
    const noDesc = await callRoute("POST", `/api/clients/${SLUG}/change-orders`, { action: "add", desc: " " });
    expect(noDesc.status === 400, `no desc: got ${noDesc.status}`);
    const a = await callRoute("POST", `/api/clients/${SLUG}/change-orders`, {
      action: "add",
      desc: "QA change one",
    });
    expect(a.status === 200, a.text);
    expect((a.json?.changeOrders as any[])[0].amount === "0", "first change order not free");
    const b = await callRoute("POST", `/api/clients/${SLUG}/change-orders`, {
      action: "add",
      desc: "QA change two",
      amount: "12,000",
    });
    expect((b.json?.changeOrders as any[])[1].amount === "12,000", "override amount lost");
    const badRm = await callRoute("POST", `/api/clients/${SLUG}/change-orders`, { action: "remove", index: 99 });
    expect(badRm.status === 404, `bad remove: got ${badRm.status}`);
    const rm = await callRoute("POST", `/api/clients/${SLUG}/change-orders`, { action: "remove", index: 1 });
    expect(rm.status === 200 && (rm.json?.changeOrders as any[]).length === 1, "remove failed");
  });

  await test("handover refuses before delivery (400)", async () => {
    const r = await callRoute("POST", `/api/clients/${SLUG}/handover`);
    expect(r.status === 400, `got ${r.status}: ${r.text}`);
  });

  await test("payments: invalid amount is a 400", async () => {
    const r = await callRoute("POST", `/api/clients/${SLUG}/payments`, { action: "add", amount: -5 });
    expect(r.status === 400, `got ${r.status}: ${r.text}`);
  });

  await test("payments: recording a payment advances the stage to development", async () => {
    const r = await callRoute("POST", `/api/clients/${SLUG}/payments`, {
      action: "add",
      amount: 19_500,
      method: "QA test",
      invoiceSlug,
    });
    expect(r.status === 200, `got ${r.status}: ${r.text.slice(0, 200)}`);
    expect(r.json?.stage === "development", `stage: ${r.json?.stage}`);
  });

  await test("billing: final receipt publish marks the client delivered", async () => {
    const r = await callRoute("POST", `/api/clients/${SLUG}/billing`, {
      action: "generate",
      kind: "receipt",
      stage: "final",
    });
    expect(r.status === 200, `generate: ${r.text.slice(0, 200)}`);
    const rec = (await getRecord())!;
    const receipt = (rec.billing ?? []).find((b: Rec) => b.kind === "receipt");
    expect(receipt, "receipt missing");
    const pub = await callRoute("POST", `/api/clients/${SLUG}/billing`, {
      action: "publish",
      doc: receipt.slug,
    });
    expect(pub.status === 200, `publish: ${pub.text}`);
    expect((await getRecord())!.stage === "delivered", "stage not delivered");
  });

  await test("payments: remove works and bad refs are rejected", async () => {
    const badRef = await callRoute("POST", `/api/clients/${SLUG}/payments`, {
      action: "add",
      amount: 100,
      invoiceSlug: "no-such-invoice",
    });
    expect(badRef.status === 400, `bad invoiceSlug: got ${badRef.status}`);
    const extra = await callRoute("POST", `/api/clients/${SLUG}/payments`, {
      action: "add",
      amount: 1000,
      method: "QA extra",
    });
    expect(extra.status === 200, extra.text);
    const badRm = await callRoute("POST", `/api/clients/${SLUG}/payments`, { action: "remove", index: 99 });
    expect(badRm.status === 404, `bad remove: got ${badRm.status}`);
    const rm = await callRoute("POST", `/api/clients/${SLUG}/payments`, { action: "remove", index: 1 });
    expect(rm.status === 200 && (rm.json?.payments as any[]).length === 1, "remove failed");
  });

  await test("handover pack generates once delivered (billing kind handover)", async () => {
    const r = await callRoute("POST", `/api/clients/${SLUG}/handover`);
    expect(r.status === 200, `got ${r.status}: ${r.text.slice(0, 160)}`);
    const rec = (await getRecord())!;
    expect((rec.billing ?? []).some((b: Rec) => b.kind === "handover"), "handover missing");
  });

  await test("manual stage override works and re-stamps delivery", async () => {
    const r = await callRoute("POST", `/api/clients/${SLUG}/stage`, { stage: "development" });
    expect(r.status === 200 && r.json?.stage === "development", r.text);
    const rec = (await getRecord())!;
    expect(!rec.deliveredAt, "deliveredAt not cleared moving back");
    const bad = await callRoute("POST", `/api/clients/${SLUG}/stage`, { stage: "nonsense" });
    expect(bad.status === 400, `unknown stage: got ${bad.status}`);
  });

  await test("notes save and clear", async () => {
    const a = await callRoute("POST", `/api/clients/${SLUG}/notes`, { notes: "QA suite note." });
    expect(a.status === 200, a.text);
    expect((await getRecord())!.notes === "QA suite note.", "note not stored");
    const b = await callRoute("POST", `/api/clients/${SLUG}/notes`, { notes: "  " });
    expect(b.status === 200, b.text);
    expect(!(await getRecord())!.notes, "note not cleared");
  });

  await test("tasks add → toggle → remove (and bad indices are 404s)", async () => {
    const a = await callRoute("POST", `/api/clients/${SLUG}/tasks`, { action: "add", text: "QA task" });
    expect(a.status === 200, a.text);
    const t = await callRoute("POST", `/api/clients/${SLUG}/tasks`, { action: "toggle", index: 0 });
    expect(t.status === 200, t.text);
    expect((await getRecord())!.tasks?.[0]?.done === true, "task not toggled");
    const bad = await callRoute("POST", `/api/clients/${SLUG}/tasks`, { action: "toggle", index: 42 });
    expect(bad.status >= 400, `bad index: got ${bad.status}`);
    const d = await callRoute("POST", `/api/clients/${SLUG}/tasks`, { action: "remove", index: 0 });
    expect(d.status === 200, d.text);
    expect(((await getRecord())!.tasks ?? []).length === 0, "task not removed");
  });

  await test("search finds the client by brief content", async () => {
    const r = await callRoute("GET", "/api/search", undefined, { q: "bakery" });
    expect(r.status === 200, `got ${r.status}: ${r.text.slice(0, 120)}`);
    expect(r.text.includes(SLUG), `no hit for ${SLUG}: ${r.text.slice(0, 200)}`);
  });

  await test("CSV export includes the client row", async () => {
    const r = await callRoute("GET", "/api/clients/export");
    expect(r.status === 200, `got ${r.status}`);
    expect(r.text.startsWith("Company,"), "no CSV header");
    expect(r.text.includes("QA Suite Testing"), "client row missing");
  });

  await test("inbox: opening an update marks exactly that one read", async () => {
    const { recentActivity, isNotifiable, entryKey, getReadKeys } = await import("../../lib/activity");
    const ev = (await recentActivity(50)).find((e) => e.target === SLUG && isNotifiable(e));
    expect(ev, "no notifiable event for the fixture");
    const r = await callRoute("GET", "/api/activity/open", undefined, {
      at: ev.at,
      target: ev.target,
      action: ev.action,
    });
    expect(r.status >= 300 && r.status < 400, `expected redirect, got ${r.status}`);
    expect(r.headers.location?.includes(`/clients/${SLUG}`), `location: ${r.headers.location}`);
    expect((await getReadKeys()).has(entryKey(ev)), "entry not marked read");
  });

  await test("inbox: an invalid target never redirects off the dashboard", async () => {
    const r = await callRoute("GET", "/api/activity/open", undefined, {
      at: "2026-01-01T00:00:00.000Z",
      target: "../evil",
      action: "x",
    });
    expect(r.status >= 300 && r.status < 400, `got ${r.status}`);
    expect(new URL(r.headers.location!).pathname === "/", `location: ${r.headers.location}`);
  });

  await test("inbox: mark-all-read stamps seenAt and clears per-item reads", async () => {
    const r = await callRoute("POST", "/api/activity/read");
    expect(r.status === 200, r.text);
    const { getNotificationsSeenAt, getReadKeys } = await import("../../lib/activity");
    const seen = await getNotificationsSeenAt();
    expect(Date.now() - Date.parse(seen) < 30_000, `seenAt stale: ${seen}`);
    expect((await getReadKeys()).size === 0, "read list not reset");
  });

  await test("activity feed recorded the lifecycle", async () => {
    const { activityFor } = await import("../../lib/activity");
    const events = await activityFor(SLUG, 100);
    expect(events.length >= 8, `only ${events.length} events`);
    const actions = events.map((e) => e.action).join(" | ");
    for (const needle of ["published quotation", "recorded payment", "generated"]) {
      expect(actions.includes(needle), `missing "${needle}" in: ${actions.slice(0, 300)}`);
    }
  });

  await test("deletion with a wrong password is refused (403)", async () => {
    const r = await callRoute("DELETE", `/api/clients/${SLUG}`, { password: "wrong-password" });
    expect(r.status === 403, `got ${r.status}: ${r.text}`);
  });

  await teardown("teardown");
  await test("fixture fully removed", async () => {
    expect((await getRecord()) === null, "record still present after teardown");
  });

  finish("Client lifecycle suite");
}

main().catch(async (e) => {
  console.error(e);
  await teardown("crash-clean").catch(() => {});
  process.exit(1);
});

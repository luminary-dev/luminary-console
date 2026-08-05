// One-off: seed Ecomech Engineering (today's manually-built LUM-*-0043 docs)
// into the console so the platform starts with the real first client.
// Run locally: vercel env pull && npm run seed:ecomech
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { saveClient } = await import("../lib/store");
  const { saveDoc } = await import("../lib/pipeline");
  const { ensureClientDomain } = await import("../lib/domains");

  const client: import("../lib/types").ClientRecord = {
    slug: "eco-mech",
    company: "Ecomech Engineering Lanka (Pvt) Ltd.",
    reg: "PV110496",
    address: "No. 39-5/1, Inner Fairline Road, Dehiwala, Sri Lanka",
    email: "ecomech.lk@samakej.com.my",
    phone: "+94 77 468 0274",
    contactName: undefined,
    brief:
      "Landing page for an MEP engineering firm. UX & design LKR 5,000–10,000; development LKR 30,000–40,000. Cost scales with page count: 2–3 pages +5,000–7,000/page, 4–6 pages +3,000–5,000/page beyond 3, 7+ custom quote.",
    projectLabel: "Landing page — UX & development",
    docNoBase: "0043",
    status: "created" as const,
    createdAt: new Date().toISOString(),
    domain: "eco-mech.luminary-dev.xyz",
    dnsStatus: "manual_required" as const,
    extraQuestions: [],
    docs: {},
  };

  const estimate = {
    confidence: "± 15%",
    about:
      "A budgetary estimate for the design and build of a landing page for Ecomech Engineering Lanka. Figures are ranges — a fixed quotation follows once scope is confirmed. All amounts in Sri Lankan Rupees (LKR).",
    items: [
      {
        title: "UX & Design",
        desc: "Discovery, content structure, wireframe & high-fidelity page design",
        effort: "3–5 d",
        range: "5,000–10,000",
      },
      {
        title: "Development",
        desc: "Responsive build, contact/enquiry form, technical SEO & deployment",
        effort: "1–2 wk",
        range: "30,000–40,000",
      },
    ],
    lowTotal: "LKR 35,000",
    highTotal: "LKR 50,000",
    likelyTotal: "≈ LKR 42,500",
    totalNote: "Single landing page · Not a final bill",
    scaling: {
      title: "How cost scales with page count",
      rows: [
        { scope: "1 page — this estimate", detail: "landing page, up to ~7 sections", range: "LKR 35,000–50,000" },
        { scope: "2–3 pages", detail: "+LKR 5,000–7,000 per additional page", range: "LKR 40,000–64,000" },
        { scope: "4–6 pages", detail: "+LKR 3,000–5,000 per additional page beyond 3", range: "LKR 48,000–79,000" },
        { scope: "7+ pages", detail: "scoped separately as a multi-page site", range: "Custom quote" },
      ],
      note: "Additional pages cost less because they reuse the design system and deployment built for page one.",
    },
    changeFactors:
      "Final section count, copywriting & photography needs, third-party integrations, and revision rounds. We flag anything that moves the estimate before work starts.",
    nextStep:
      "Happy with the range? Fill in the questionnaire and we'll lock scope and send a fixed, itemised quotation — free and with no obligation.",
  };

  await saveDoc(client, "estimate", estimate, "published");
  const dns = await ensureClientDomain(client.slug);
  client.dnsStatus = dns.status;
  await saveClient(client);
  console.log("Seeded eco-mech:", JSON.stringify({ dns }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

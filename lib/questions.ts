// The discovery questionnaire, parameterized per client. Base schema is the
// battle-tested Ecomech questionnaire, generalized; Claude may append a few
// client-specific questions per section (ExtraQuestion in the client record).
import type { ClientRecord } from "./types";

export type Field =
  | {
      id: string;
      type: "text" | "textarea";
      label: string;
      hint?: string;
      placeholder?: string;
      rows?: number;
      width?: "half" | "full";
      required?: boolean;
    }
  | {
      id: string;
      type: "checks";
      label: string;
      hint?: string;
      options: string[];
      grid?: boolean;
      other?: boolean;
    }
  | {
      id: string;
      type: "upload";
      label: string;
      hint?: string;
    };

export type Section = {
  id: string;
  eyebrow: string;
  title: string;
  sub?: string;
  fields: Field[];
};

export function buildSections(client: ClientRecord): Section[] {
  const co = (client.company.split("(")[0] ?? client.company).trim();
  const short = co.split(" ").slice(0, 2).join(" ");

  const sections: Section[] = [
    {
      id: "you",
      eyebrow: "Before we start",
      title: "Who's filling this in",
      fields: [
        { id: "contactName", type: "text", label: "Your name", width: "half", required: true },
        { id: "contactRole", type: "text", label: `Your role at ${short}`, width: "half" },
        { id: "contactEmail", type: "text", label: "Best email to reach you", width: "half" },
        { id: "contactPhone", type: "text", label: "Best phone / WhatsApp", width: "half" },
      ],
    },
    {
      id: "business",
      eyebrow: "Section 01 · Your business",
      title: "Who you are and what you do",
      fields: [
        { id: "describe", type: "textarea", rows: 3, required: true, label: `Describe ${short} in 2–3 sentences.`, hint: "Exactly as you'd explain it to a brand-new customer. This often becomes the first line of the website." },
        { id: "vision", type: "textarea", rows: 2, label: "Your vision.", hint: `Where is the company headed — what do you want ${short} to become in 5–10 years?` },
        { id: "mission", type: "textarea", rows: 2, label: "Your mission.", hint: "What you do every day and why. If you have official vision/mission statements, paste them exactly." },
        { id: "values", type: "text", label: "Core values.", hint: "3–5 words or short phrases the company stands by." },
        { id: "tagline", type: "text", width: "half", label: "Slogan or tagline", hint: "If you have one — or want us to write one." },
        { id: "founded", type: "text", width: "half", label: "Founded / years in operation", hint: "Plus any milestones worth telling." },
        { id: "services", type: "textarea", rows: 5, required: true, label: "List your core services or products, most important first.", hint: "Up to 8. A line of detail per item helps us write them properly.", placeholder: "1.\n2.\n3." },
        { id: "different", type: "textarea", rows: 3, label: "What makes you different from competitors?", hint: "Speed, certifications, in-house team, pricing, after-service — whatever customers actually choose you for." },
        { id: "areas", type: "text", width: "half", label: "Areas you serve", placeholder: "e.g. islandwide, Colombo & suburbs, overseas" },
        { id: "stats", type: "text", width: "half", label: "Numbers worth showing off", hint: "Projects done, clients, team size, years — stats build trust fast." },
      ],
    },
    {
      id: "goals",
      eyebrow: "Section 02 · Goals & expectations",
      title: "What this project needs to achieve — and what you expect from us",
      fields: [
        { id: "job", type: "checks", other: true, label: "The #1 job of this project is to… (pick the closest)", options: ["Generate enquiries & leads", "Look credible for tenders & proposals", "Showcase our work"] },
        { id: "action", type: "checks", label: "When a visitor is convinced, what should they do first?", options: ["Call", "WhatsApp", "Email", "Fill an enquiry form"] },
        { id: "lookingFor", type: "textarea", rows: 3, label: "What are you looking for — in your own words?", hint: "Forget web jargon. What should be true after launch that isn't true today?" },
        { id: "success", type: "textarea", rows: 2, label: "What does success look like 6 months after launch?" },
        { id: "expectations", type: "textarea", rows: 2, label: "What do you expect from Luminary as a partner?", hint: "Communication style, updates, honesty about trade-offs — tell us how to work well with you." },
        { id: "mustHaves", type: "textarea", rows: 2, label: "Absolute must-haves and deal-breakers.", hint: "Anything that MUST be included, and anything that would make you reject a design outright." },
      ],
    },
    {
      id: "customers",
      eyebrow: "Section 03 · Your customers",
      title: "Who we're designing for",
      fields: [
        { id: "customer", type: "textarea", rows: 3, label: "Who is your typical customer?", hint: "Industries, company types, and the person who usually contacts you." },
        { id: "questions", type: "textarea", rows: 3, label: "Top 3 questions customers always ask before hiring you.", hint: "We'll answer these directly on the page — it's the highest-converting content there is.", placeholder: "1.\n2.\n3." },
        { id: "matters", type: "text", label: "What matters most to them when choosing a business like yours?", hint: "Price? Certifications? Speed? Warranty? References? Rank the top few." },
        { id: "objections", type: "textarea", rows: 2, label: "Common doubts or objections you have to overcome." },
      ],
    },
    {
      id: "brand",
      eyebrow: "Section 04 · Logo & brand assets",
      title: "What you have — attach files right here",
      fields: [
        { id: "logo", type: "checks", grid: true, label: "Your logo — tick all that apply:", hint: "Attach the best files you have below — even a letterhead or business card scan helps.", options: ["We have a logo (attaching it below)", "We have vector files (AI / SVG / EPS / PDF)", "We only have images (PNG / JPG / from documents)", "We have light & dark versions", "We'd like the logo cleaned up / redrawn", "We don't have a logo — please design one"] },
        { id: "assets", type: "checks", grid: true, label: "Other brand assets — tick everything you can send:", options: ["Brand guidelines / colour codes document", "Company profile / brochure (PDF)", "Photos of projects or work", "Photos of team / premises", "Letterheads, business cards, signage photos", "Client testimonials or reviews", "Videos (site work, promos, walkthroughs)", "Awards / certificates (scans)"] },
        { id: "brandFiles", type: "upload", label: "Attach your brand files here.", hint: "Logo files, brand guidelines, brochures, letterheads, photos — images, PDFs, Word, PowerPoint, anything up to 15 MB per file." },
        { id: "certifications", type: "text", label: "Certifications & registrations to display." },
        { id: "clients", type: "textarea", rows: 2, label: "Notable clients or projects we're allowed to name or show.", hint: "Only what you have permission to publish." },
      ],
    },
    {
      id: "design",
      eyebrow: "Section 05 · Design, colour & UI",
      title: "How it should look and feel",
      sub: "This is the section that shapes the design most — the more specific you are here, the closer the first draft lands.",
      fields: [
        { id: "inspirations", type: "textarea", rows: 4, label: "Inspirations — websites you like, any industry.", hint: "Paste links, and for each one a few words on WHY. Screenshots go in the next question.", placeholder: "https://…  — what we like about it" },
        { id: "inspirationFiles", type: "upload", label: "Attach inspiration screenshots.", hint: "Screenshots of sites or designs you like — mark them up if you can." },
        { id: "dislikes", type: "textarea", rows: 2, label: "Websites or styles you DON'T like.", hint: "Just as useful as the likes." },
        { id: "feel", type: "checks", label: "The site should feel… (tick up to 2)", options: ["Corporate & precise", "Modern & bold", "Warm & approachable", "Technical & detailed", "Premium & understated"] },
        { id: "colourTheme", type: "checks", label: "Overall colour theme:", options: ["Light & clean", "Dark & premium", "Follow our logo colours", "Designer's choice — surprise us"] },
        { id: "colours", type: "text", width: "half", label: "Colours to use", hint: "Exact codes if you know them, or just names." },
        { id: "coloursAvoid", type: "text", width: "half", label: "Colours / styles to avoid" },
        { id: "typography", type: "checks", label: "Typography direction:", options: ["Clean modern sans-serif", "Classic serif touches", "Technical / engineered feel", "Designer's choice"] },
        { id: "imagery", type: "checks", grid: true, label: "Imagery style:", options: ["Real photos of our work & team (preferred if available)", "Professional stock photography", "Technical illustrations / diagrams", "Abstract / 3D graphics"] },
        { id: "motion", type: "checks", label: "Motion & animation:", options: ["Subtle & professional (recommended)", "Rich & eye-catching", "Minimal — almost none"] },
        { id: "features", type: "checks", grid: true, label: "UI features you'd like — tick any that appeal:", hint: "Not sure what something is? Leave it — we'll recommend the right set.", options: ["Floating WhatsApp / call button", "Photo gallery / slider", "Animated stats counters", "Client logo strip", "Testimonials carousel", "Google Map of our location", "Dark / light mode toggle", "Video section", "FAQ accordion", "Downloadable company profile (PDF)"] },
        { id: "dontWant", type: "text", label: "Anything you definitely DON'T want.", placeholder: "e.g. pop-ups, autoplay video, stock photos of handshakes…" },
      ],
    },
    {
      id: "content",
      eyebrow: "Section 06 · Content & page sections",
      title: "What goes on the page",
      fields: [
        { id: "sections", type: "checks", grid: true, label: "Sections to include — tick all you want:", hint: "A landing page works best with 6–8 focused sections — we'll advise on the final set.", options: ["Hero (headline + main action)", "About us / who we are", "Vision & mission", "Services / products", "Completed projects / portfolio", "Certifications & registrations", "Clients & partners", "Testimonials", "Our team", "Process — how we work", "FAQ", "Contact & enquiry form"] },
        { id: "copywriter", type: "checks", label: "Who writes the text?", options: ["We'll send our own text", "Luminary writes it from this form (recommended)", "Mix — we'll send notes, you polish"] },
        { id: "enquiryForm", type: "textarea", rows: 2, label: "Enquiry form — what should it ask, and where do submissions go?" },
        { id: "existingContent", type: "text", label: "Existing content we can pull from.", hint: "Old website, Facebook page — links here; files below." },
        { id: "contentFiles", type: "upload", label: "Attach any content documents.", hint: "Company profile, price lists, text drafts — Word, PDF, spreadsheets." },
      ],
    },
    {
      id: "practical",
      eyebrow: "Section 07 · Practical & technical",
      title: "The things that block launches",
      fields: [
        { id: "domain", type: "text", width: "half", label: "Do you own a domain name?", hint: "If not, we'll register one with you." },
        { id: "hosting", type: "text", width: "half", label: "Existing website or hosting?", hint: "If any — we'll handle migration or start fresh." },
        { id: "publishContact", type: "textarea", rows: 3, label: "Contact details to publish on the site.", hint: "Phone(s), email, address, business hours — exactly as they should appear publicly." },
        { id: "social", type: "text", width: "half", label: "Social / profile links to include" },
        { id: "languages", type: "text", width: "half", label: "Languages needed", placeholder: "English only? Sinhala / Tamil too?" },
        { id: "seo", type: "textarea", rows: 2, label: "What might customers type into Google to find you?", hint: "A few phrases, plus the locations that matter — this drives the SEO we build in." },
        { id: "whatsapp", type: "text", width: "half", label: "WhatsApp number for the chat button", hint: "If different from the main line." },
        { id: "googleBusiness", type: "text", width: "half", label: "Google Business profile?", hint: "Yes / no / not sure — we'll set one up if missing." },
      ],
    },
    {
      id: "timeline",
      eyebrow: "Section 08 · Timeline & approval",
      title: "How we'll work together",
      fields: [
        { id: "launch", type: "text", width: "half", label: "Target launch date?", hint: "And anything driving it — a tender, exhibition, campaign." },
        { id: "approver", type: "text", width: "half", label: "Who gives final approval?", hint: "One point of contact keeps revisions fast." },
        { id: "channel", type: "checks", label: "Preferred way to communicate", options: ["WhatsApp", "Email", "Calls"] },
        { id: "assetsWhen", type: "text", label: "When can you send the assets?", hint: "Logo, photos, documents — a date keeps the timeline honest." },
        { id: "anythingElse", type: "textarea", rows: 3, label: "Anything else we should know?" },
      ],
    },
  ];

  // Splice in Claude's client-specific questions.
  for (const [i, q] of (client.extraQuestions ?? []).entries()) {
    const section = sections.find((s) => s.id === q.sectionId);
    if (!section) continue;
    section.fields.push({
      id: `extra_${i}`,
      type: q.kind,
      ...(q.kind === "textarea" ? { rows: 3 } : {}),
      label: q.label,
      ...(q.hint !== undefined ? { hint: q.hint } : {}),
    });
  }

  return sections;
}

export function validIds(client: ClientRecord): Set<string> {
  const ids = new Set<string>();
  for (const s of buildSections(client)) {
    for (const f of s.fields) {
      ids.add(f.id);
      if (f.type === "checks" && f.other) ids.add(`${f.id}Other`);
    }
  }
  return ids;
}

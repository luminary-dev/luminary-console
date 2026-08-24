// AI drafting for the publish portal — Claude Opus 5 with structured outputs
// (same pattern as lib/generate.ts, but with the landing page's public voice
// rather than the client-document voice). Drafts are always reviewed and
// edited in the portal before anything is published; publishing itself is a
// PR into the landing repo's dev branch, so nothing ships unreviewed.
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-5";

const BLOG_SYSTEM = `You draft long-form posts for the Luminary engineering blog (luminary-dev.xyz/blog). Luminary is a full-service digital studio in Colombo, Sri Lanka — web design & development (Next.js/React), brand & motion, cloud & DevOps.

Voice: a senior practitioner writing to peers — practical, specific, first-person plural ("we"), opinionated but honest about trade-offs. British-adjacent spelling. No hype, no filler, no listicle fluff. Concrete numbers, commands and code where they earn their place. GitHub-flavored markdown: ## section headings, tables and fenced code blocks where useful. Do NOT include an H1 (the page renders the title) and do NOT include frontmatter. Never mention AI or that this was drafted.`;

const PROJECT_SYSTEM = `You draft portfolio case-study entries for Luminary (a digital studio in Colombo, Sri Lanka — luminary-dev.xyz/work). Each entry is a TypeScript object rendered into a designed case-study page.

Voice: confident, warm, concrete — the studio telling the story of a real build (problem → approach → what we built → outcome). Keep every field tight and skimmable. Outcomes are 4 punchy metric cards: short value (a number or one word), short label, one-line detail. Never invent client names or figures the brief doesn't support — for engineering/open-source projects realistic representative figures are fine.`;

function extractJson<T>(msg: Anthropic.Message): T {
  if (msg.stop_reason === "refusal") throw new Error("Model declined the request.");
  const text = msg.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("No text in response.");
  return JSON.parse(text.text) as T;
}

async function draft<T>(system: string, prompt: string, schema: Record<string, unknown>): Promise<T> {
  const client = new Anthropic();
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system,
    output_config: { format: { type: "json_schema", schema } },
    messages: [{ role: "user", content: prompt }],
  } as Parameters<typeof client.beta.messages.stream>[0]);
  return extractJson<T>((await stream.finalMessage()) as unknown as Anthropic.Message);
}

const S = {
  str: { type: "string" } as const,
  obj(required: string[], properties: Record<string, unknown>) {
    return { type: "object", additionalProperties: false, required, properties };
  },
  arr(items: unknown) {
    return { type: "array", items };
  },
};

// ——— Articles ———

export type ArticleDraft = {
  title: string;
  slug: string;
  excerpt: string;
  tags: string[];
  body: string;
  imageBrief: string;
};

const ARTICLE_SCHEMA = S.obj(["title", "slug", "excerpt", "tags", "body", "imageBrief"], {
  title: { type: "string", description: "Post title — specific and earnest, not clickbait." },
  slug: { type: "string", description: "kebab-case URL slug, lowercase letters/digits/hyphens." },
  excerpt: { type: "string", description: "1–2 sentence standfirst for the card and OG description." },
  tags: { ...S.arr(S.str), description: "3–5 short lowercase topic tags." },
  body: {
    type: "string",
    description:
      "Full post in GitHub-flavored markdown, 900–1600 words. ## headings, code/tables where they help. No H1, no frontmatter.",
  },
  imageBrief: {
    type: "string",
    description:
      "One-sentence scene for the cover illustration: a whimsical visual metaphor for the post (physical scenes — machinery, workshops, harbours, skies — not screenshots).",
  },
});

export function draftArticle(brief: string): Promise<ArticleDraft> {
  return draft<ArticleDraft>(
    BLOG_SYSTEM,
    `Draft a Luminary blog post from this brief:\n\n${brief}`,
    ARTICLE_SCHEMA,
  );
}

// ——— Projects ———

export type ProjectDraft = {
  slug: string;
  name: string;
  category: string;
  tagline: string;
  liveUrl: string;
  accent: string;
  motif: string;
  kind: "web" | "engineering";
  year: string;
  timeline: string;
  location: string;
  services: string[];
  stack: string[];
  overview: string;
  problem: string;
  approach: string;
  build: string[];
  outcomes: { value: string; label: string; detail: string }[];
  result: string;
  deploy?: { lighthouse: string; lcp: string; bundle: string };
  arch?: { label: string; sub: string }[];
  run?: string[];
  imageBrief: string;
};

const OUTCOME = S.obj(["value", "label", "detail"], {
  value: { type: "string", description: "Short metric value, e.g. '98+', '$46K', 'Direct'." },
  label: S.str,
  detail: { type: "string", description: "One line." },
});

const PROJECT_SCHEMA = S.obj(
  [
    "slug", "name", "category", "tagline", "liveUrl", "accent", "motif", "kind",
    "year", "timeline", "location", "services", "stack", "overview", "problem",
    "approach", "build", "outcomes", "result", "deploy", "arch", "run", "imageBrief",
  ],
  {
    slug: { type: "string", description: "kebab-case slug." },
    name: S.str,
    category: { type: "string", description: "e.g. 'Hospitality · Website' or 'Cloud · FinOps Tool'." },
    tagline: { type: "string", description: "One evocative line." },
    liveUrl: { type: "string", description: "Live site URL (web) or GitHub repo URL (engineering). Use the brief's URL; never invent domains — if none given, use an empty string." },
    accent: { type: "string", description: "A hex brand colour for the project, e.g. '#c9a227'." },
    motif: { type: "string", description: "One lowercase word for the project's icon motif, e.g. 'paw', 'rings', 'book', 'cloud', 'loop', 'shield'." },
    kind: { type: "string", enum: ["web", "engineering"] },
    year: S.str,
    timeline: { type: "string", description: "e.g. '2 weeks' or 'Solo build'." },
    location: { type: "string", description: "Place (web) or focus, e.g. 'Reference architecture' (engineering)." },
    services: { ...S.arr(S.str), description: "3–4 services." },
    stack: { ...S.arr(S.str), description: "3–6 technologies." },
    overview: { type: "string", description: "2–3 sentence case overview." },
    problem: { type: "string", description: "2–3 sentences." },
    approach: { type: "string", description: "2–3 sentences." },
    build: { ...S.arr(S.str), description: "Exactly 6 short 'what we built' bullets." },
    outcomes: { ...S.arr(OUTCOME), description: "Exactly 4 outcome metric cards." },
    result: { type: "string", description: "One closing line." },
    deploy: S.obj(["lighthouse", "lcp", "bundle"], {
      lighthouse: { type: "string", description: "e.g. '98' — web projects only; use '0' for engineering." },
      lcp: { type: "string", description: "e.g. '0.8s'." },
      bundle: { type: "string", description: "e.g. '112 kB'." },
    }),
    arch: {
      ...S.arr(S.obj(["label", "sub"], { label: S.str, sub: S.str })),
      description: "Engineering only: 5–7 pipeline/architecture nodes. Empty array for web projects.",
    },
    run: {
      ...S.arr(S.str),
      description:
        "Engineering only: 5–8 terminal lines ($ = input, ✓ = ok, ● = note, end with 'ready.'). Empty array for web projects.",
    },
    imageBrief: {
      type: "string",
      description: "One-sentence scene for the thumbnail artwork: a warm, characterful physical scene that captures the project (people/places for web builds; whimsical machinery metaphors for engineering).",
    },
  },
);

export function draftProject(brief: string): Promise<ProjectDraft> {
  return draft<ProjectDraft>(
    PROJECT_SYSTEM,
    `Draft a Luminary case-study entry from this brief:\n\n${brief}`,
    PROJECT_SCHEMA,
  );
}

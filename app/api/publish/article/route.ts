import { NextResponse } from "next/server";
import { coverPrompt, generateImage } from "@/lib/publish/images";
import { landingFileExists, openLandingPR } from "@/lib/publish/github";

export const runtime = "nodejs";
export const maxDuration = 300;

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,80}$/;

// Publishes a blog article to the landing page: generates the cover in the
// house Tintin-3D style, writes content/blog/<slug>.md + the cover image, and
// opens a PR against the landing repo's dev branch.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const title = String(body.title || "").trim();
  const markdown = String(body.body || "").trim();
  const excerpt = String(body.excerpt || "").trim();
  const imageBrief = String(body.imageBrief || "").trim();
  const draftFlag = Boolean(body.draft);
  const tags: string[] = Array.isArray(body.tags)
    ? body.tags.map((t: unknown) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 6)
    : [];
  let slug = String(body.slug || "").trim().toLowerCase();
  if (!slug) {
    slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  if (!title || markdown.length < 200) {
    return NextResponse.json({ error: "Title and a body of at least a few paragraphs are required." }, { status: 400 });
  }
  if (!SLUG_RE.test(slug)) {
    return NextResponse.json({ error: "Slug must be lowercase letters, digits and dashes." }, { status: 400 });
  }

  try {
    if (await landingFileExists(`content/blog/${slug}.md`)) {
      return NextResponse.json({ error: `A post with slug "${slug}" already exists.` }, { status: 409 });
    }

    const cover = await generateImage(coverPrompt(imageBrief || `${title} — ${excerpt || "an engineering story"}`));

    const date = new Date().toISOString().slice(0, 10);
    const fm = [
      "---",
      `title: ${JSON.stringify(title)}`,
      `date: "${date}"`,
      `author: "Dhanika Kumarasiri"`,
      `tags: [${tags.map((t) => JSON.stringify(t)).join(", ")}]`,
      `cover: "/blog/${slug}/cover.jpg"`,
      ...(excerpt ? [`excerpt: ${JSON.stringify(excerpt)}`] : []),
      ...(draftFlag ? ["draft: true"] : []),
      "---",
      "",
    ].join("\n");

    const pr = await openLandingPR({
      branch: `content/article-${slug}`,
      commitMessage: `content: publish "${title}"`,
      prTitle: `content: publish "${title}"`,
      prBody: [
        `New blog post **${title}** (\`/blog/${slug}\`), published from the console portal.`,
        "",
        `- \`content/blog/${slug}.md\` — ${markdown.split(/\s+/).length} words, tags: ${tags.join(", ") || "—"}${draftFlag ? ", **draft: true**" : ""}`,
        `- \`public/blog/${slug}/cover.jpg\` — generated cover (house 3D-animation style)`,
        "",
        "Review the copy and the cover on the Vercel preview, then merge to publish on dev.",
        "Remember the version bump if this PR rides to prod on its own.",
        "",
        "🤖 Published via luminary-console",
      ].join("\n"),
      files: [
        { path: `content/blog/${slug}.md`, text: fm + markdown + "\n" },
        { path: `public/blog/${slug}/cover.jpg`, base64: cover.toString("base64") },
      ],
    });

    return NextResponse.json({
      slug,
      prUrl: pr.url,
      prNumber: pr.number,
      cover: `data:image/jpeg;base64,${cover.toString("base64")}`,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Publish failed." }, { status: 502 });
  }
}

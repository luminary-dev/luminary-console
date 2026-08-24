import { NextResponse } from "next/server";
import { coverPrompt, generateImage, inlinePrompt } from "@/lib/publish/images";
import { landingBranchExists, landingFileExists, openLandingPR } from "@/lib/publish/github";
import { draftInlineScenes, type InlineScene } from "@/lib/publish/draft";
import { sendTelegram, tgEsc } from "@/lib/telegram";
import { sendPush } from "@/lib/push";
import { currentOperator } from "@/lib/operator";

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
  let markdown = String(body.body || "").trim();
  // 0, 1 or 2 in-article illustrations, placed under well-spaced sections.
  const inlineCount = Math.min(2, Math.max(0, Number(body.inlineImages) || 0));
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
    // A branch from an earlier publish means a PR is (or was) in flight —
    // opening a second would let one silently overwrite the other on merge.
    if (await landingBranchExists(`content/article-${slug}`)) {
      return NextResponse.json(
        { error: `"${slug}" already has a publish PR in flight — merge or close it (and delete its branch) first.` },
        { status: 409 },
      );
    }

    const cover = await generateImage(coverPrompt(imageBrief || `${title} — ${excerpt || "an engineering story"}`));

    // Inline illustrations: Claude picks the sections and scenes, gpt-image-2
    // renders them, and each is inserted right under its "## " heading (or at
    // sensible fallback spots when the heading text doesn't match).
    const inlineFiles: { path: string; base64: string }[] = [];
    const inlinePreviews: string[] = [];
    if (inlineCount > 0) {
      let scenes: InlineScene[] = [];
      try {
        scenes = (await draftInlineScenes(title, markdown, inlineCount)).scenes.slice(0, inlineCount);
      } catch {
        scenes = []; // scene drafting is an enhancement — never fail the publish over it
      }
      const images = await Promise.all(scenes.map((s) => generateImage(inlinePrompt(s.scene))));
      const lines = markdown.split("\n");
      scenes.forEach((s, i) => {
        const src = `/blog/${slug}/inline-${i + 1}.jpg`;
        const block = ["", `![${s.alt.replace(/[\[\]]/g, "")}](${src})`, ""];
        const at = lines.findIndex(
          (l) => l.startsWith("## ") && l.slice(3).trim().toLowerCase() === s.afterHeading.trim().toLowerCase(),
        );
        if (at >= 0) {
          lines.splice(at + 1, 0, ...block);
        } else {
          // Heading drifted — drop the image after the middle-ish blank line.
          const mid = Math.floor(lines.length * ((i + 1) / (scenes.length + 1)));
          let insert = lines.length;
          for (let j = mid; j < lines.length; j++) {
            if (lines[j].trim() === "") {
              insert = j;
              break;
            }
          }
          lines.splice(insert, 0, ...block);
        }
        inlineFiles.push({ path: `public/blog/${slug}/inline-${i + 1}.jpg`, base64: images[i].toString("base64") });
        inlinePreviews.push(`data:image/jpeg;base64,${images[i].toString("base64")}`);
      });
      markdown = lines.join("\n");
    }

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
        ...inlineFiles.map((f, i) => `- \`${f.path}\` — inline illustration ${i + 1}, placed in the body`),
        "",
        "Review the copy and the cover on the Vercel preview, then merge to publish on dev.",
        "Remember the version bump if this PR rides to prod on its own.",
        "",
        "🤖 Published via luminary-console",
      ].join("\n"),
      files: [
        { path: `content/blog/${slug}.md`, text: fm + markdown + "\n" },
        { path: `public/blog/${slug}/cover.jpg`, base64: cover.toString("base64") },
        ...inlineFiles,
      ],
    });

    // Team awareness — same convention as payments/acceptances: best-effort,
    // never blocks the publish.
    await sendTelegram(
      [
        `📝 <b>Article published → PR</b> · ${tgEsc(title)}`,
        [
          `/blog/${slug}${draftFlag ? " (draft: true)" : ""}`,
          tags.length ? `Tags: ${tgEsc(tags.join(", "))}` : "",
          inlineFiles.length
            ? `Cover + ${inlineFiles.length} inline illustration${inlineFiles.length > 1 ? "s" : ""}`
            : "Cover generated",
          `By ${tgEsc(await currentOperator())}`,
        ]
          .filter(Boolean)
          .join("\n"),
        `<a href="${pr.url}">Review the PR →</a>`,
      ].join("\n\n"),
    );
    await sendPush({
      title: `Article published → PR · ${title}`,
      body: `/blog/${slug} — tap to review the PR`,
      url: pr.url,
    });

    return NextResponse.json({
      slug,
      prUrl: pr.url,
      prNumber: pr.number,
      cover: `data:image/jpeg;base64,${cover.toString("base64")}`,
      inline: inlinePreviews,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Publish failed." }, { status: 502 });
  }
}

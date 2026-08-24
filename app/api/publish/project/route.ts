import { NextResponse } from "next/server";
import { generateImage, thumbPrompts } from "@/lib/publish/images";
import { fetchLandingFile, landingBranchExists, openLandingPR } from "@/lib/publish/github";
import type { ProjectDraft } from "@/lib/publish/draft";

export const runtime = "nodejs";
export const maxDuration = 300;

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,60}$/;
const PROJECTS_PATH = "lib/projects.ts";

// Serialize the project entry as a TS object literal matching the file's
// style (unquoted identifier keys, 2-space indent, nested inside the array).
function toTsEntry(p: Record<string, unknown>): string {
  const json = JSON.stringify(p, null, 2);
  const unquoted = json.replace(/^(\s*)"([A-Za-z_$][A-Za-z0-9_$]*)":/gm, "$1$2:");
  return unquoted
    .split("\n")
    .map((l) => "  " + l)
    .join("\n");
}

// Adds a project to the landing page: generates the light/dark thumbnail pair
// in the house Tintin-3D style, inserts the entry into lib/projects.ts, and
// opens a PR against dev.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const p = body?.project as ProjectDraft | undefined;
  const imageBrief = String(body?.imageBrief || p?.imageBrief || "").trim();
  if (!p || typeof p !== "object") {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const slug = String(p.slug || "").trim().toLowerCase();
  const required: (keyof ProjectDraft)[] = [
    "name", "category", "tagline", "accent", "motif", "kind", "year",
    "timeline", "location", "overview", "problem", "approach", "result",
  ];
  const missing = required.filter((k) => !String(p[k] ?? "").trim());
  if (!SLUG_RE.test(slug)) {
    return NextResponse.json({ error: "Slug must be lowercase letters, digits and dashes." }, { status: 400 });
  }
  if (missing.length || !Array.isArray(p.services) || !Array.isArray(p.stack) || !Array.isArray(p.build) || !Array.isArray(p.outcomes)) {
    return NextResponse.json({ error: `Missing fields: ${missing.join(", ") || "services/stack/build/outcomes"}.` }, { status: 400 });
  }
  if (!imageBrief) {
    return NextResponse.json({ error: "An image brief for the thumbnail scene is required." }, { status: 400 });
  }
  const isEng = p.kind === "engineering";

  try {
    const source = await fetchLandingFile(PROJECTS_PATH);
    if (!source) throw new Error(`Could not read ${PROJECTS_PATH} from the landing repo.`);
    if (source.includes(`slug: "${slug}"`)) {
      return NextResponse.json({ error: `A project with slug "${slug}" already exists.` }, { status: 409 });
    }
    // A branch from an earlier publish means a PR is (or was) in flight —
    // opening a second would let one silently overwrite the other on merge.
    if (await landingBranchExists(`content/project-${slug}`)) {
      return NextResponse.json(
        { error: `"${slug}" already has a publish PR in flight — merge or close it (and delete its branch) first.` },
        { status: 409 },
      );
    }
    const anchor = "\n];";
    const at = source.lastIndexOf(anchor);
    if (at === -1) throw new Error("Could not locate the PROJECTS array closing in lib/projects.ts.");

    // Build the entry in the landing repo's Project shape (field order matters
    // only for readability). Web projects get shots + deploy; engineering gets
    // arch + run.
    const entry: Record<string, unknown> = {
      slug,
      name: p.name,
      category: p.category,
      tagline: p.tagline,
      liveUrl: p.liveUrl || "",
      accent: p.accent,
      motif: p.motif,
      ...(isEng ? { kind: "engineering" } : {}),
      year: p.year,
      timeline: p.timeline,
      location: p.location,
      services: p.services,
      stack: p.stack,
      overview: p.overview,
      problem: p.problem,
      approach: p.approach,
      build: p.build,
      ...(isEng
        ? { arch: p.arch ?? [], run: p.run ?? [] }
        : {}),
      outcomes: p.outcomes,
      result: p.result,
      ...(!isEng && p.deploy && p.deploy.lighthouse !== "0" ? { deploy: p.deploy } : {}),
    };

    const prompts = thumbPrompts(imageBrief);
    const [light, dark] = await Promise.all([
      generateImage(prompts.light),
      generateImage(prompts.dark),
    ]);

    const updated = source.slice(0, at) + "\n" + toTsEntry(entry) + "," + source.slice(at);

    const pr = await openLandingPR({
      branch: `content/project-${slug}`,
      commitMessage: `content: add project "${p.name}"`,
      prTitle: `content: add project "${p.name}"`,
      prBody: [
        `New ${isEng ? "Cloud & DevOps" : "web"} project **${p.name}** (\`/work/${slug}\`), added from the console portal.`,
        "",
        `- \`lib/projects.ts\` — new entry appended to PROJECTS`,
        `- \`public/work/thumbs/${slug}-light.jpg\` / \`-dark.jpg\` — generated day/dusk thumbnails (house 3D-animation style)`,
        "",
        ...(isEng
          ? ["The case page renders the architecture diagram + terminal run from the entry — no other assets needed."]
          : [
              "### Before merging",
              `- [ ] Add device screenshots: \`public/work/${slug}-desktop.png\`, \`-tablet.png\`, \`-mobile.png\`, then add \`shots: shots("${slug}")\` to the entry (the case page's device showcase needs them).`,
            ]),
        "Remember the version bump if this PR rides to prod on its own.",
        "",
        "🤖 Published via luminary-console",
      ].join("\n"),
      files: [
        { path: PROJECTS_PATH, text: updated },
        { path: `public/work/thumbs/${slug}-light.jpg`, base64: light.toString("base64") },
        { path: `public/work/thumbs/${slug}-dark.jpg`, base64: dark.toString("base64") },
      ],
    });

    return NextResponse.json({
      slug,
      prUrl: pr.url,
      prNumber: pr.number,
      thumbLight: `data:image/jpeg;base64,${light.toString("base64")}`,
      thumbDark: `data:image/jpeg;base64,${dark.toString("base64")}`,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Publish failed." }, { status: 502 });
  }
}

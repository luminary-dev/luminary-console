// QA suite — landing-page project publishing (/api/publish/project), covering
// BOTH project kinds: engineering (a GitHub repo with architecture + terminal
// run) and web (a complete website with deploy figures and a screenshots
// checklist). Also exercises the AI draft's kind detection. Dummy data;
// every PR/branch is torn down.
//
//   npx tsx --env-file=.env.local scripts/tests/suite-project.ts
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { callRoute } from "../invoke";
import { test, expect, note, finish, landingFile, closePr, deleteBranch, openPrFor } from "./harness";

const ENG_SLUG = "qa-suite-eng-project";
const WEB_SLUG = "qa-suite-web-project";
const branchOf = (slug: string) => `content/project-${slug}`;

const BASE = {
  category: "Meta · QA",
  year: "2026",
  timeline: "QA run",
  services: ["Testing"],
  stack: ["tsx", "GitHub API", "gpt-image-2"],
  overview: 'A dummy case study created by the QA suite — it says "hello" and is never merged.',
  problem: "The publish pipeline needed a proof it handles both project kinds.",
  approach: "Publish one of each kind with awkward characters and verify the PR contents.",
  build: ["One dummy entry", 'A tagline with "quotes" & a backslash \\', "Nothing else"],
  outcomes: [
    { value: "2", label: "Kinds covered", detail: "Engineering and web." },
    { value: "0", label: "Merges", detail: "Closed by the suite." },
    { value: "100%", label: "Dummy", detail: "No real client." },
    { value: "✓", label: "Typechecked", detail: "Entry compiles." },
  ],
  result: "Safe to close.",
};

const ENG_PROJECT = {
  ...BASE,
  slug: ENG_SLUG,
  name: "QA Eng Project",
  tagline: 'An "engineering" dummy — just a GitHub repo.',
  liveUrl: "https://github.com/dhanikaa/qa-suite-dummy",
  accent: "#84cc16",
  motif: "cloud",
  kind: "engineering",
  location: "QA fixture",
  deploy: { lighthouse: "0", lcp: "", bundle: "" },
  arch: [
    { label: "suite", sub: "dispatch" },
    { label: "route", sub: "handler" },
    { label: "PR", sub: "dev branch" },
  ],
  run: ["$ qa run", "✓ both kinds", "ready."],
};

const WEB_PROJECT = {
  ...BASE,
  slug: WEB_SLUG,
  name: "QA Web Project",
  tagline: "A web dummy — a complete website build.",
  liveUrl: "https://qa-suite-dummy.example.com",
  accent: "#06b6d4",
  motif: "book",
  kind: "web",
  location: "Colombo, Sri Lanka",
  deploy: { lighthouse: "97", lcp: "0.9s", bundle: "120 kB" },
  arch: [],
  run: [],
};

const IMG = "a lighthouse keeper testing paper boats in a glass tank before letting them sail, harbour at dusk";

async function publish(project: Record<string, unknown>) {
  return callRoute("POST", "/api/publish/project", { project, imageBrief: IMG });
}

async function verifyBranch(slug: string, kind: "engineering" | "web") {
  const src = (await landingFile(branchOf(slug), "lib/projects.ts"))?.toString("utf8");
  expect(src, "projects.ts missing from branch");
  expect(src.includes(`slug: "${slug}"`), "entry not inserted");
  const entry = src.slice(src.indexOf(`slug: "${slug}"`));
  if (kind === "engineering") {
    expect(entry.includes('kind: "engineering"'), "kind missing");
    expect(entry.includes("arch:"), "arch missing");
    expect(entry.includes("run:"), "run missing");
    expect(!entry.slice(0, entry.indexOf("];")).includes("deploy:"), "deploy leaked into engineering entry");
  } else {
    expect(!entry.slice(0, 600).includes('kind: "engineering"'), "web entry marked engineering");
    expect(entry.slice(0, entry.indexOf("];")).includes("deploy:"), "deploy missing from web entry");
    expect(!entry.slice(0, 600).includes("arch:"), "arch leaked into web entry");
  }
  expect(src.lastIndexOf(`slug: "${slug}"`) < src.lastIndexOf("\n];"), "entry landed outside PROJECTS");
  // The modified file must still typecheck stand-alone.
  const tmp = `/tmp/qa-projects-${slug}.ts`;
  writeFileSync(tmp, src);
  execFileSync("npx", ["tsc", "--noEmit", "--strict", "--skipLibCheck", "--ignoreConfig", tmp], {
    stdio: "pipe",
  });
  for (const theme of ["light", "dark"] as const) {
    const img = await landingFile(branchOf(slug), `public/work/thumbs/${slug}-${theme}.jpg`);
    expect(img, `${theme} thumb missing`);
    expect(img[0] === 0xff && img[1] === 0xd8, `${theme} thumb not a JPEG`);
  }
}

async function main() {
  for (const slug of [ENG_SLUG, WEB_SLUG]) {
    const leftover = await openPrFor(branchOf(slug));
    if (leftover) await closePr(leftover);
    await deleteBranch(branchOf(slug)).catch(() => {});
  }

  console.log("Project publish suite\n");

  await test("rejects an invalid slug (400)", async () => {
    const r = await publish({ ...ENG_PROJECT, slug: "Bad Slug" });
    expect(r.status === 400, `got ${r.status}: ${r.text}`);
  });

  await test("rejects missing required fields (400)", async () => {
    const r = await publish({ slug: "qa-missing", name: "X" });
    expect(r.status === 400, `got ${r.status}: ${r.text}`);
  });

  await test("rejects a missing image brief (400)", async () => {
    const r = await callRoute("POST", "/api/publish/project", {
      project: { ...ENG_PROJECT, imageBrief: "" },
      imageBrief: "",
    });
    expect(r.status === 400, `got ${r.status}: ${r.text}`);
  });

  await test("409 on a slug already live on dev", async () => {
    const r = await publish({ ...ENG_PROJECT, slug: "leopards-rest" });
    expect(r.status === 409, `got ${r.status}: ${r.text}`);
  });

  await test("AI draft detects an engineering brief (GH repo)", async () => {
    const r = await callRoute("POST", "/api/publish/draft", {
      kind: "project",
      brief:
        "Open-source engineering project: a Terraform module registry with OPA policy gates and signed releases. Repo: github.com/dhanikaa/qa-dummy. Solo build, 2026.",
    });
    expect(r.status === 200, `got ${r.status}: ${r.text.slice(0, 160)}`);
    const d = r.json?.draft as Record<string, unknown>;
    expect(d?.kind === "engineering", `kind: ${d?.kind}`);
    expect(Array.isArray(d?.arch) && (d.arch as unknown[]).length >= 3, "no arch drafted");
    expect(Array.isArray(d?.run) && (d.run as unknown[]).length >= 3, "no run drafted");
  });

  await test("AI draft detects a web brief (client website)", async () => {
    const r = await callRoute("POST", "/api/publish/draft", {
      kind: "project",
      brief:
        "Client website: a complete marketing site for a Colombo yoga studio — brand, booking flow, blog. Live at qa-dummy-yoga.example.com. Built in 3 weeks with Next.js.",
    });
    expect(r.status === 200, `got ${r.status}: ${r.text.slice(0, 160)}`);
    const d = r.json?.draft as Record<string, unknown>;
    expect(d?.kind === "web", `kind: ${d?.kind}`);
  });

  let engPr = 0;
  await test("publishes an engineering project (repo-only) end to end", async () => {
    const r = await publish(ENG_PROJECT);
    expect(r.status === 200, `got ${r.status}: ${r.text.slice(0, 200)}`);
    engPr = Number(String(r.json?.prUrl).split("/pull/")[1]);
    expect(String(r.json?.thumbLight).startsWith("data:image/jpeg"), "no light thumb preview");
    expect(String(r.json?.thumbDark).startsWith("data:image/jpeg"), "no dark thumb preview");
    note(`engineering PR #${engPr}`);
  });

  await test("engineering branch: entry + thumbs correct, projects.ts typechecks", () =>
    verifyBranch(ENG_SLUG, "engineering"));

  await test("engineering PR body says no screenshots are needed", async () => {
    const { gh } = await import("./harness");
    const { data } = await gh<{ body: string }>(
      `/repos/${process.env.LANDING_REPO}/pulls/${engPr}`,
    );
    expect(data.body.includes("no other assets needed"), "engineering PR body wrong");
  });

  let webPr = 0;
  await test("publishes a web project (complete website) end to end", async () => {
    const r = await publish(WEB_PROJECT);
    expect(r.status === 200, `got ${r.status}: ${r.text.slice(0, 200)}`);
    webPr = Number(String(r.json?.prUrl).split("/pull/")[1]);
    note(`web PR #${webPr}`);
  });

  await test("web branch: entry + thumbs correct, projects.ts typechecks", () =>
    verifyBranch(WEB_SLUG, "web"));

  await test("web PR body carries the device-screenshots checklist", async () => {
    const { gh } = await import("./harness");
    const { data } = await gh<{ body: string }>(
      `/repos/${process.env.LANDING_REPO}/pulls/${webPr}`,
    );
    expect(data.body.includes("Add device screenshots"), "screenshots checklist missing");
    expect(data.body.includes(`shots("${WEB_SLUG}")`), "shots() hint missing");
  });

  await test("409 while an open PR already claims the slug", async () => {
    const r = await publish(ENG_PROJECT);
    expect(
      r.status === 409,
      `expected 409 for pending-PR duplicate, got ${r.status}: ${r.text.slice(0, 120)}`,
    );
  });

  // Teardown
  for (const [pr, slug] of [
    [engPr, ENG_SLUG],
    [webPr, WEB_SLUG],
  ] as const) {
    if (pr) await closePr(pr);
    await deleteBranch(branchOf(slug)).catch(() => {});
    for (const suffix of ["-2", "-3"]) {
      const extra = await openPrFor(`${branchOf(slug)}${suffix}`);
      if (extra) await closePr(extra);
      await deleteBranch(`${branchOf(slug)}${suffix}`).catch(() => {});
    }
  }
  note("teardown: PRs closed, branches deleted");

  finish("Project publish suite");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

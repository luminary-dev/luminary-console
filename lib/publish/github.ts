// GitHub plumbing for the publish portal: commit a set of files to a fresh
// branch of the landing-page repo and open a PR against `dev` (the landing
// repo is PR-only — feature/* → dev → prod). Uses the git data API so one
// commit can carry text + binary files together.
//
// Env: LANDING_REPO (owner/name, default dhanikaa/luminary-landing-page),
// LANDING_REPO_TOKEN (falls back to GH_TOKEN) — needs contents:write +
// pull_requests:write on that repo.

const REPO = () => process.env.LANDING_REPO || "dhanikaa/luminary-landing-page";
const BASE = "dev";

export type PRFile =
  | { path: string; text: string }
  | { path: string; base64: string };

function token(): string {
  const t = process.env.LANDING_REPO_TOKEN || process.env.GH_TOKEN;
  if (!t) throw new Error("LANDING_REPO_TOKEN is not configured.");
  return t;
}

async function gh<T = Record<string, unknown>>(
  path: string,
  init?: RequestInit & { expect?: number[] },
): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const data = (await res.json().catch(() => null)) as T & { message?: string };
  const ok = init?.expect ? init.expect.includes(res.status) : res.ok;
  if (!ok) {
    throw new Error(`GitHub ${init?.method || "GET"} ${path} → ${res.status}: ${data?.message || "error"}`);
  }
  return data as T;
}

/** Read a file from the landing repo at `dev` (utf-8). Null if absent. */
export async function fetchLandingFile(path: string): Promise<string | null> {
  try {
    const f = await gh<{ content?: string; encoding?: string }>(
      `/repos/${REPO()}/contents/${encodeURIComponent(path).replaceAll("%2F", "/")}?ref=${BASE}`,
    );
    if (!f.content) return null;
    return Buffer.from(f.content, "base64").toString("utf8");
  } catch (e) {
    if (String(e).includes("→ 404")) return null;
    throw e;
  }
}

export async function landingFileExists(path: string): Promise<boolean> {
  return (await fetchLandingFile(path)) !== null;
}

/**
 * Commit `files` to a new branch off `dev` and open a PR back into `dev`.
 * Returns the PR url + number.
 */
export async function openLandingPR(opts: {
  branch: string;
  commitMessage: string;
  prTitle: string;
  prBody: string;
  files: PRFile[];
}): Promise<{ url: string; number: number; branch: string }> {
  const repo = REPO();

  const ref = await gh<{ object: { sha: string } }>(`/repos/${repo}/git/ref/heads/${BASE}`);
  const baseSha = ref.object.sha;

  // Branch names get a numeric suffix instead of failing when re-publishing.
  let branch = opts.branch;
  for (let i = 0; i < 5; i++) {
    const res = await fetch(`https://api.github.com/repos/${repo}/git/refs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token()}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
    });
    if (res.ok) break;
    if (res.status === 422 && i < 4) {
      branch = `${opts.branch}-${i + 2}`;
      continue;
    }
    const err = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(`Could not create branch ${branch}: ${err?.message || res.status}`);
  }

  const tree = await Promise.all(
    opts.files.map(async (f) => {
      const blob = await gh<{ sha: string }>(`/repos/${repo}/git/blobs`, {
        method: "POST",
        body:
          "text" in f
            ? JSON.stringify({ content: f.text, encoding: "utf-8" })
            : JSON.stringify({ content: f.base64, encoding: "base64" }),
      });
      return { path: f.path, mode: "100644" as const, type: "blob" as const, sha: blob.sha };
    }),
  );

  const baseCommit = await gh<{ tree: { sha: string } }>(`/repos/${repo}/git/commits/${baseSha}`);
  const newTree = await gh<{ sha: string }>(`/repos/${repo}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree }),
  });
  const commit = await gh<{ sha: string }>(`/repos/${repo}/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message: opts.commitMessage, tree: newTree.sha, parents: [baseSha] }),
  });
  await gh(`/repos/${repo}/git/refs/heads/${branch}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha }),
  });

  const pr = await gh<{ html_url: string; number: number }>(`/repos/${repo}/pulls`, {
    method: "POST",
    body: JSON.stringify({ title: opts.prTitle, head: branch, base: BASE, body: opts.prBody }),
  });
  return { url: pr.html_url, number: pr.number, branch };
}

// Tiny test harness for the QA suites — sequential tests against the real
// route handlers (via scripts/invoke.ts) and real backends, with dummy data
// that is torn down at the end of each suite.
let pass = 0;
let fail = 0;
const failures: string[] = [];

export async function test(name: string, fn: () => Promise<void>): Promise<void> {
  const t0 = Date.now();
  try {
    await fn();
    pass++;
    console.log(`  ✓ ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (e) {
    fail++;
    const msg = e instanceof Error ? e.message : String(e);
    failures.push(`${name}: ${msg}`);
    console.log(`  ✗ ${name} — ${msg}`);
  }
}

export function expect(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

export function note(msg: string): void {
  console.log(`  · ${msg}`);
}

export function finish(suite: string): never {
  console.log(`\n${suite}: ${pass} passed, ${fail} failed`);
  if (failures.length) console.log(failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(fail ? 1 : 0);
}

// ——— GitHub helpers (verification + teardown of test PRs/branches) ———

const REPO = () => process.env.LANDING_REPO || "dhanikaa/luminary-landing-page";

export async function gh<T = Record<string, unknown>>(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; data: T }> {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.LANDING_REPO_TOKEN}`,
      Accept: "application/vnd.github+json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  return { status: res.status, data: (await res.json().catch(() => null)) as T };
}

/** Raw file content from a branch of the landing repo (null if absent). */
export async function landingFile(branch: string, path: string): Promise<Buffer | null> {
  const res = await fetch(
    `https://api.github.com/repos/${REPO()}/contents/${path}?ref=${branch}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.LANDING_REPO_TOKEN}`,
        Accept: "application/vnd.github.raw+json",
      },
    },
  );
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

export async function closePr(prNumber: number): Promise<void> {
  await gh(`/repos/${REPO()}/pulls/${prNumber}`, {
    method: "PATCH",
    body: JSON.stringify({ state: "closed" }),
  });
}

export async function deleteBranch(branch: string): Promise<void> {
  await gh(`/repos/${REPO()}/git/refs/heads/${branch}`, { method: "DELETE" });
}

export async function openPrFor(branch: string): Promise<number | null> {
  const { data } = await gh<{ number: number }[]>(
    `/repos/${REPO()}/pulls?state=open&head=${REPO().split("/")[0]}:${branch}`,
  );
  return Array.isArray(data) && data[0] ? data[0].number : null;
}

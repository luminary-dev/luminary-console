// Dispatches the "Ops: console API" GitHub Actions workflow — the execution
// plane for console business mutations when OPS_VIA_ACTIONS is on. The proxy
// rewrites those requests to /api/ops/relay, which calls this and then waits
// for the runner to write the result back into the store.
//
// Env: CONSOLE_REPO (owner/name, default luminary-dev/luminary-console) and
// CONSOLE_REPO_TOKEN — a fine-grained PAT on that repo with Actions:write.

const WORKFLOW = "ops-run.yml";

const repo = () => process.env.CONSOLE_REPO || "luminary-dev/luminary-console";

export function opsDispatchConfigured(): boolean {
  return Boolean(process.env.CONSOLE_REPO_TOKEN);
}

export async function dispatchOps(inputs: {
  method: string;
  path: string;
  body?: string;
  request_id: string;
  actor?: string;
}): Promise<void> {
  const token = process.env.CONSOLE_REPO_TOKEN;
  if (!token) throw new Error("CONSOLE_REPO_TOKEN is not configured.");
  const res = await fetch(
    `https://api.github.com/repos/${repo()}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ref: "main",
        inputs: {
          method: inputs.method,
          path: inputs.path,
          ...(inputs.body ? { body: inputs.body } : {}),
          request_id: inputs.request_id,
          ...(inputs.actor ? { actor: inputs.actor } : {}),
        },
      }),
    },
  );
  if (res.status !== 204) {
    const err = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(`Workflow dispatch failed (${res.status}): ${err?.message || "error"}`);
  }
}

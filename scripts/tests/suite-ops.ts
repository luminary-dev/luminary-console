// QA suite — the ops/relay plumbing and failure paths, all zero-cost: relay
// guards, opsFetch routing decisions (stubbed fetch), dispatch/auth failures,
// publish routes' backend-failure handling (bad tokens fail BEFORE any image
// is generated), route resolution, cron auth, and misc console endpoints.
//
//   npx tsx --env-file=.env.local scripts/tests/suite-ops.ts
import { callRoute, resolveRoute } from "../invoke";
import { test, expect, finish } from "./harness";

async function withEnv<T>(patch: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(patch)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

async function main() {
  console.log("Ops & plumbing suite\n");

  await test("route resolution: unknown path throws, catch-all resolves", async () => {
    expect((await resolveRoute("/api/nope/nothing")) === null, "unknown path resolved");
    const m = await resolveRoute("/api/asset/some/nested/key");
    expect(m !== null, "catch-all did not resolve");
    // Next hands [...catchall] params over as a string ARRAY.
    expect(
      Array.isArray(m!.params.key) && (m!.params.key as string[]).join("/") === "some/nested/key",
      `catch-all params: ${JSON.stringify(m!.params)}`,
    );
  });

  await test("ping answers, sessions lists, missing asset 404s", async () => {
    const ping = await callRoute("GET", "/api/ping");
    expect(ping.status === 200, `ping: ${ping.status}`);
    const sessions = await callRoute("GET", "/api/sessions");
    expect(sessions.status === 200, `sessions: ${sessions.status}`);
    const asset = await callRoute("GET", "/api/asset/qa/none.pdf");
    expect(asset.status === 404, `missing asset: ${asset.status}`);
  });

  await test("cron endpoints refuse without the bearer secret", async () => {
    for (const p of ["/api/cron/backup", "/api/cron/digest"]) {
      let status = 0;
      for (const m of ["GET", "POST"]) {
        try {
          status = (await callRoute(m, p)).status;
          break;
        } catch {} // no handler for this method — try the next
      }
      expect(status === 401 || status === 403, `${p}: got ${status}`);
    }
  });

  await test("relay: 400 on non-relayable paths, even when configured", async () => {
    await withEnv({ OPS_VIA_ACTIONS: "1", CONSOLE_REPO_TOKEN: "dummy" }, async () => {
      for (const path of ["/api/sessions", "/api/ops/relay", "/api/activity/read", "/etc/passwd"]) {
        const r = await callRoute("POST", "/api/ops/relay", "{}", { path });
        expect(r.status === 400, `${path}: got ${r.status}`);
      }
    });
  });

  await test("relay: reports fallback when the flag is off or token missing", async () => {
    for (const patch of [{ OPS_VIA_ACTIONS: undefined }, { OPS_VIA_ACTIONS: "1", CONSOLE_REPO_TOKEN: undefined }]) {
      await withEnv(patch, async () => {
        const r = await callRoute("POST", "/api/ops/relay", "{}", { path: "/api/clients/x/notes" });
        expect(r.status === 503, `got ${r.status}`);
        expect(r.json?.fallback === true, `no fallback marker: ${r.text}`);
      });
    }
  });

  await test("relay: a bad dispatch token surfaces as a 502, not a hang", async () => {
    await withEnv({ OPS_VIA_ACTIONS: "1", CONSOLE_REPO_TOKEN: "github_pat_invalid" }, async () => {
      const r = await callRoute("POST", "/api/ops/relay", "{}", { path: "/api/clients/x/notes" });
      expect(r.status === 502, `got ${r.status}: ${r.text.slice(0, 160)}`);
      expect(r.text.includes("dispatch failed"), `message: ${r.text.slice(0, 160)}`);
    });
  });

  await test("opsFetch: relays business mutations, passes reads through", async () => {
    const { opsFetch } = await import("../../lib/ops-fetch");
    const calls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: any) => {
      calls.push(`${init?.method || "GET"} ${String(input)}`);
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    try {
      await opsFetch("/api/clients/eco-mech/notes", { method: "POST", body: "{}" });
      await opsFetch("/api/clients/eco-mech", {});
      await opsFetch("/api/activity/read", { method: "POST" });
      await opsFetch("/api/publish/article", { method: "POST", body: "{}" });
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(calls[0].includes("/api/ops/relay?path=%2Fapi%2Fclients%2Feco-mech%2Fnotes"), `1: ${calls[0]}`);
    expect(calls[1] === "GET /api/clients/eco-mech", `2: ${calls[1]}`);
    expect(calls[2] === "POST /api/activity/read", `3: ${calls[2]}`);
    expect(calls[3].includes("/api/ops/relay?path=%2Fapi%2Fpublish%2Farticle"), `4: ${calls[3]}`);
  });

  await test("opsFetch: falls back to direct execution on the 503 marker", async () => {
    const { opsFetch } = await import("../../lib/ops-fetch");
    const calls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any) => {
      calls.push(String(input));
      return calls.length === 1
        ? new Response(JSON.stringify({ fallback: true }), { status: 503 })
        : new Response('{"ok":true}', { status: 200 });
    }) as typeof fetch;
    try {
      const res = await opsFetch("/api/clients/x/notes", { method: "POST", body: "{}" });
      expect(res.status === 200, `status: ${res.status}`);
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(calls.length === 2 && calls[1] === "/api/clients/x/notes", `calls: ${calls.join(" | ")}`);
  });

  await test("opsFetch: a real 503 error (no marker) is returned, not retried", async () => {
    const { opsFetch } = await import("../../lib/ops-fetch");
    let calls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls++;
      return new Response('{"error":"down"}', { status: 503 });
    }) as typeof fetch;
    try {
      const res = await opsFetch("/api/clients/x/notes", { method: "POST", body: "{}" });
      expect(res.status === 503 && calls === 1, `status ${res.status}, calls ${calls}`);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  await test("operator attribution honors OPS_ACTOR on the runner", async () => {
    await withEnv({ OPS_ACTOR: "qa@luminary-dev.xyz" }, async () => {
      const { currentOperator } = await import("../../lib/operator");
      expect((await currentOperator()) === "qa@luminary-dev.xyz", "OPS_ACTOR ignored");
    });
  });

  await test("publish article: GitHub-token failure is a clean 502 before any image", async () => {
    await withEnv({ LANDING_REPO_TOKEN: "github_pat_invalid", GH_TOKEN: undefined }, async () => {
      const r = await callRoute("POST", "/api/publish/article", {
        title: "QA failure-path probe",
        slug: "qa-ops-suite-probe",
        body: "x".repeat(300),
      });
      expect(r.status === 502, `got ${r.status}: ${r.text.slice(0, 160)}`);
      expect(r.text.includes("GitHub"), `message: ${r.text.slice(0, 160)}`);
    });
  });

  await test("publish article: OpenAI failure is a clean 502 with a readable message", async () => {
    await withEnv({ OPENAI_API_KEY: "sk-invalid" }, async () => {
      const r = await callRoute("POST", "/api/publish/article", {
        title: "QA failure-path probe",
        slug: "qa-ops-suite-probe",
        body: "x".repeat(300),
      });
      expect(r.status === 502, `got ${r.status}: ${r.text.slice(0, 160)}`);
      expect(r.text.includes("Image generation failed"), `message: ${r.text.slice(0, 160)}`);
    });
  });

  await test("publish article: a punctuation-only title cannot mint a slug (400)", async () => {
    const r = await callRoute("POST", "/api/publish/article", {
      title: "!!! ???",
      body: "x".repeat(300),
    });
    expect(r.status === 400, `got ${r.status}: ${r.text.slice(0, 120)}`);
  });

  await test("publish article: missing OpenAI key is a clean failure", async () => {
    await withEnv({ OPENAI_API_KEY: undefined }, async () => {
      const r = await callRoute("POST", "/api/publish/article", {
        title: "QA failure-path probe",
        slug: "qa-ops-suite-probe",
        body: "x".repeat(300),
      });
      expect(r.status === 502, `got ${r.status}`);
      expect(r.text.includes("OPENAI_API_KEY"), `message: ${r.text.slice(0, 160)}`);
    });
  });

  finish("Ops & plumbing suite");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

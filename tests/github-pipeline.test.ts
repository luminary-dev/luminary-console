// Integration test for the ingestion pipeline, exercising the real route
// handler with an in-memory store and a stubbed GitHub API.
//
// This is where the acceptance criteria for the ingestion phase are checked:
// duplicate, out-of-order, malformed and replayed deliveries must all produce
// correct state, and a tampered body must be refused.
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "pipeline-test-secret";

// Fixture timestamps are RELATIVE to a base captured when the module loads,
// never absolute dates.
//
// They used to be absolute (at(-1)), which was a time bomb.
// The webhook receiver rejects a delivery whose payload timestamp is more than
// WEBHOOK_MAX_AGE_MS (5 minutes) old, so those literals passed only while the
// wall clock happened to sit near them: written in the morning they were in
// the future, and by the same afternoon they were hours stale and six tests
// went red without a line of code changing. A test that depends on the date it
// is run is worse than no test, because it fails in CI long after the change
// that appears to have broken it.
//
// Offsets stay inside the freshness window and preserve the ordering the
// out-of-order and newer-wins cases depend on.
const BASE = Date.now();
const at = (minutesFromNow: number): string =>
  new Date(BASE + minutesFromNow * 60_000).toISOString();

// ——— in-memory store ———
// Mocking at the store boundary keeps the test honest about everything above
// it (route, verification, inbox, processor, handlers) while never touching
// R2. The key space behaves like the real one: one object per key.
const objects = new Map<string, unknown>();

vi.mock("@/lib/store", () => ({
  readState: vi.fn(async (path: string) =>
    objects.has(path) ? structuredClone(objects.get(path)) : null,
  ),
  writeState: vi.fn(async (path: string, data: unknown) => {
    objects.set(path, structuredClone(data));
  }),
  clearState: vi.fn(async (path: string) => {
    objects.delete(path);
  }),
  listState: vi.fn(async (prefix: string) =>
    [...objects.keys()]
      .filter((k) => k.startsWith(prefix))
      .map((k) => `console/state/${k}`),
  ),
}));

// The activity log reaches the store through another module; stub it so the
// audit call in the route does not need the real thing.
vi.mock("@/lib/operator", () => ({
  currentOperator: vi.fn(async () => "test@luminary-dev.xyz"),
  logOperatorActivity: vi.fn(async () => {}),
}));

// ——— stubbed GitHub API ———
// Handlers reconcile by re-reading the entity, which is exactly the behaviour
// under test, so the stub records how often it was asked and can change its
// answer between calls.
const apiState = {
  prState: "open" as "open" | "closed" | "merged",
  prTitle: "Add a thing",
  prUpdatedAt: at(-1),
  fetchCount: 0,
  missing: false,
};

vi.mock("@/lib/github/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/github/api")>("@/lib/github/api");
  return {
    ...actual,
    fetchPullRequest: vi.fn(async (repo: string, number: number) => {
      apiState.fetchCount += 1;
      if (apiState.missing) return null;
      return {
        id: 500 + number,
        repo,
        number,
        title: apiState.prTitle,
        state: apiState.prState,
        draft: false,
        author: { id: 1, login: "dhanika" },
        assignees: [],
        requestedReviewers: [],
        labels: [],
        headRef: "feat/thing",
        headSha: "abc1234",
        baseRef: "main",
        fromFork: false,
        createdAt: at(-3),
        updatedAt: apiState.prUpdatedAt,
        mergeable: true,
        url: `https://github.com/${repo}/pull/${number}`,
        reviews: [],
        checks: [],
        syncedAt: new Date().toISOString(),
      };
    }),
    fetchRepo: vi.fn(async () => null),
  };
});

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

function deliveryRequest(
  body: string,
  opts: { id?: string; event?: string; signature?: string } = {},
): Request {
  return new Request("https://console.example.test/api/github/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": opts.event ?? "pull_request",
      "x-github-delivery": opts.id ?? "delivery-1",
      "x-hub-signature-256": opts.signature ?? sign(body),
    },
    body,
  });
}

function prPayload(overrides: Record<string, unknown> = {}): string {
  // `pull_request` is merged rather than replaced, so a test can override one
  // field of it without dropping the rest and accidentally producing a
  // schema-invalid payload.
  const { pull_request: prOverrides, ...rest } = overrides;
  return JSON.stringify({
    action: "opened",
    created_at: new Date().toISOString(),
    repository: { id: 1, name: "console", full_name: "luminary-dev/console" },
    ...rest,
    pull_request: {
      id: 507,
      number: 7,
      state: "open",
      title: "Add a thing",
      created_at: at(-3),
      updated_at: at(-1),
      head: { ref: "feat/thing", sha: "abc1234" },
      base: { ref: "main", sha: "def5678" },
      ...(prOverrides as object | undefined),
    },
  });
}

beforeEach(() => {
  objects.clear();
  apiState.prState = "open";
  apiState.prTitle = "Add a thing";
  apiState.prUpdatedAt = at(-1);
  apiState.fetchCount = 0;
  apiState.missing = false;
  process.env.GITHUB_WEBHOOK_SECRET = SECRET;
  process.env.GH_TOKEN = "test-token";
  vi.clearAllMocks();
});

describe("receive path", () => {
  it("accepts a correctly signed delivery and stores it", async () => {
    const { POST } = await import("@/app/api/github/webhook/route");
    const body = prPayload();
    const res = await POST(deliveryRequest(body));

    expect(res.status).toBe(200);
    const stored = objects.get("github/deliveries/delivery-1.json") as {
      event: string;
      state: string;
      repo: string;
    };
    expect(stored).toBeDefined();
    expect(stored.event).toBe("pull_request");
    expect(stored.repo).toBe("luminary-dev/console");
  });

  it("refuses a tampered body and stores nothing", async () => {
    const { POST } = await import("@/app/api/github/webhook/route");
    const original = prPayload();
    const tampered = prPayload({ pull_request: { number: 999 } });
    // Signature is valid for `original`, so the tampered body must fail.
    const res = await POST(
      deliveryRequest(tampered, { signature: sign(original) }),
    );

    expect(res.status).toBe(401);
    expect(objects.size).toBe(0);
  });

  it("never parses a body it has not verified", async () => {
    // A malformed body with a bad signature must be rejected on the
    // signature, not blow up in JSON.parse, which would be evidence that
    // parsing happened first.
    const { POST } = await import("@/app/api/github/webhook/route");
    const res = await POST(
      deliveryRequest("this is not json at all", { signature: "sha256=bogus" }),
    );
    expect(res.status).toBe(401);
    expect(objects.size).toBe(0);
  });
});

describe("duplicate delivery", () => {
  it("produces no duplicate state when GitHub redelivers the same id", async () => {
    const { POST } = await import("@/app/api/github/webhook/route");
    const { processDelivery } = await import("@/lib/github/processor");
    const body = prPayload();

    const first = await POST(deliveryRequest(body, { id: "dup-1" }));
    expect(first.status).toBe(200);
    await processDelivery("dup-1");

    const second = await POST(deliveryRequest(body, { id: "dup-1" }));
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ duplicate: true });

    // One delivery record, one projection, regardless of how many times it
    // arrived.
    const deliveries = [...objects.keys()].filter((k) => k.startsWith("github/deliveries/"));
    const projections = [...objects.keys()].filter((k) => k.startsWith("github/prs/"));
    expect(deliveries).toHaveLength(1);
    expect(projections).toHaveLength(1);
  });

  it("is idempotent when the same delivery is processed twice", async () => {
    const { POST } = await import("@/app/api/github/webhook/route");
    const { processDelivery } = await import("@/lib/github/processor");
    await POST(deliveryRequest(prPayload(), { id: "idem-1" }));

    await processDelivery("idem-1");
    const afterFirst = structuredClone(objects.get("github/prs/luminary-dev_console/7.json"));
    await processDelivery("idem-1");
    const afterSecond = objects.get("github/prs/luminary-dev_console/7.json") as {
      syncedAt: string;
    };

    // Everything except the sync stamp must be identical: reconciling twice
    // cannot change the answer.
    const strip = (o: unknown) => {
      const { syncedAt, ...rest } = o as { syncedAt: string };
      void syncedAt;
      return rest;
    };
    expect(strip(afterSecond)).toEqual(strip(afterFirst));
  });
});

describe("out-of-order delivery", () => {
  it("reconciles to the API's truth rather than applying a stale payload", async () => {
    // The scenario from the mandate: a redelivered `closed` arrives after the
    // PR has been reopened. Applying the payload would resurrect the stale
    // state; reconciling cannot.
    const { POST } = await import("@/app/api/github/webhook/route");
    const { processDelivery } = await import("@/lib/github/processor");

    apiState.prState = "open"; // the API's current truth

    const staleClosed = prPayload({
      action: "closed",
      pull_request: { state: "closed", updated_at: at(-2) },
    });
    await POST(deliveryRequest(staleClosed, { id: "ooo-1" }));
    await processDelivery("ooo-1");

    const projected = objects.get("github/prs/luminary-dev_console/7.json") as { state: string };
    // The payload said closed; the API says open; the API wins.
    expect(projected.state).toBe("open");
  });

  it("does not let an older projection overwrite a newer one", async () => {
    const { putPullRequest, getPullRequest } = await import("@/lib/github/projection");
    const base = {
      id: 1,
      repo: "luminary-dev/console",
      number: 7,
      title: "Newer",
      state: "open" as const,
      draft: false,
      assignees: [],
      requestedReviewers: [],
      labels: [],
      headRef: "a",
      headSha: "b",
      baseRef: "main",
      fromFork: false,
      createdAt: at(-3),
      updatedAt: at(1),
      mergeable: true,
      url: "https://example.test",
      reviews: [],
      checks: [],
      syncedAt: new Date().toISOString(),
    };
    await putPullRequest(base);

    const older = { ...base, title: "Older", updatedAt: at(-4) };
    const result = await putPullRequest(older);

    expect(result.written).toBe(false);
    expect((await getPullRequest("luminary-dev/console", 7))?.title).toBe("Newer");
  });
});

describe("malformed and unknown payloads", () => {
  it("sends a payload that fails its schema to the dead letter, not to a handler", async () => {
    const { POST } = await import("@/app/api/github/webhook/route");
    const { processDelivery } = await import("@/lib/github/processor");

    // A pull_request event with no pull_request object.
    const broken = JSON.stringify({
      action: "opened",
      created_at: new Date().toISOString(),
      repository: { id: 1, name: "console", full_name: "luminary-dev/console" },
    });
    await POST(deliveryRequest(broken, { id: "bad-1" }));
    const outcome = await processDelivery("bad-1");

    expect(outcome.state).toBe("failed");
    const stored = objects.get("github/deliveries/bad-1.json") as { issues?: string[] };
    expect(stored.issues?.join(" ")).toContain("pull_request");
  });

  it("acknowledges an event type we do not model rather than failing it", async () => {
    // GitHub disables a webhook that keeps erroring, so an unmodelled event
    // must be skipped, not treated as a fault.
    const { POST } = await import("@/app/api/github/webhook/route");
    const { processDelivery } = await import("@/lib/github/processor");

    const body = JSON.stringify({ action: "created", created_at: new Date().toISOString() });
    const res = await POST(deliveryRequest(body, { id: "unknown-1", event: "sponsorship" }));
    expect(res.status).toBe(200);

    const outcome = await processDelivery("unknown-1");
    expect(outcome.state).toBe("skipped");
  });
});

describe("replay", () => {
  it("replays a failed delivery and resets its attempt count", async () => {
    const { POST } = await import("@/app/api/github/webhook/route");
    const { processDelivery, replayDelivery } = await import("@/lib/github/processor");

    // Fail it first by making the API say the PR is gone, then recover.
    await POST(deliveryRequest(prPayload(), { id: "replay-1" }));
    apiState.missing = true;
    await processDelivery("replay-1");

    apiState.missing = false;
    const outcome = await replayDelivery("replay-1");

    expect(outcome.state).toBe("processed");
    const stored = objects.get("github/deliveries/replay-1.json") as { attempts: number };
    expect(stored.attempts).toBe(1);
  });

  it("replays every failed delivery inside a time range", async () => {
    const { POST } = await import("@/app/api/github/webhook/route");
    const { processDelivery, replayRange } = await import("@/lib/github/processor");

    const broken = JSON.stringify({
      action: "opened",
      created_at: new Date().toISOString(),
      repository: { id: 1, name: "console", full_name: "luminary-dev/console" },
    });
    for (const id of ["range-1", "range-2"]) {
      await POST(deliveryRequest(broken, { id }));
      await processDelivery(id);
    }

    const from = new Date(Date.now() - 60_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const outcomes = await replayRange(from, to);
    expect(outcomes).toHaveLength(2);
  });

  it("refuses a range whose end precedes its start", async () => {
    const { replayRange } = await import("@/lib/github/processor");
    await expect(
      replayRange(at(1), at(-1)),
    ).rejects.toThrow();
  });
});

describe("entity removal", () => {
  it("removes the projection when the pull request no longer exists", async () => {
    const { POST } = await import("@/app/api/github/webhook/route");
    const { processDelivery } = await import("@/lib/github/processor");

    await POST(deliveryRequest(prPayload(), { id: "gone-1" }));
    await processDelivery("gone-1");
    expect(objects.has("github/prs/luminary-dev_console/7.json")).toBe(true);

    // The repository was deleted or transferred; a later event reconciles to
    // "not found" and the stale projection must go.
    apiState.missing = true;
    await POST(deliveryRequest(prPayload({ action: "closed" }), { id: "gone-2" }));
    await processDelivery("gone-2");

    expect(objects.has("github/prs/luminary-dev_console/7.json")).toBe(false);
  });
});

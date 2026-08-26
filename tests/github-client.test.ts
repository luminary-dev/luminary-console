// API client tests: the rate limit semantics, pagination, and the edge cases
// section 3.7 calls out (ETag 304 mishandled as empty, Link headers stopping
// early, X-RateLimit-Reset in the past, GitHub 502 on large queries).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetRateLimit,
  backoffMs,
  classifyLimit,
  currentRateLimit,
  recordRateLimit,
  MAX_WAIT_MS,
} from "@/lib/github/ratelimit";
import { parseNextLink } from "@/lib/github/client";
import { atIndex } from "./helpers";

// The tests below replace globalThis.fetch deliberately. Each one puts a
// throwing stub back afterwards rather than leaving a live-looking fake in
// place for whatever runs next in the same worker.
function blockNetwork(): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    throw new Error(`Network access is blocked in unit tests (attempted: ${String(input)}).`);
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  __resetRateLimit();
});

afterEach(() => {
  blockNetwork();
  vi.useRealTimers();
  delete process.env.GH_TOKEN;
});

describe("rate limit classification", () => {
  it("distinguishes a secondary limit from an ordinary permissions 403", () => {
    // Both are 403. Only the message tells them apart, and treating a
    // secondary limit as a permissions error would give up instead of backing
    // off, while the reverse would retry a request that can never succeed.
    const secondary = classifyLimit(
      403,
      new Headers(),
      "You have exceeded a secondary rate limit. Please wait a few minutes before you try again.",
    );
    expect(secondary).toBe("secondary");

    const forbidden = classifyLimit(403, new Headers({ "x-ratelimit-remaining": "4999" }), "Resource not accessible by integration");
    expect(forbidden).toBeNull();
  });

  it("classifies an exhausted primary budget", () => {
    const headers = new Headers({ "x-ratelimit-remaining": "0" });
    expect(classifyLimit(403, headers, "API rate limit exceeded")).toBe("primary");
  });

  it("treats abuse detection wording as a secondary limit", () => {
    expect(
      classifyLimit(403, new Headers(), "You have triggered an abuse detection mechanism"),
    ).toBe("secondary");
  });

  it("treats a 429 with budget remaining as secondary", () => {
    expect(classifyLimit(429, new Headers({ "x-ratelimit-remaining": "100" }))).toBe("secondary");
  });
});

describe("backoff", () => {
  it("waits until the reset for a primary limit", () => {
    const resetIn = 30; // seconds
    const headers = new Headers({
      "x-ratelimit-remaining": "0",
      "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + resetIn),
    });
    const wait = backoffMs("primary", 0, headers);
    expect(wait).toBeGreaterThan(25_000);
    expect(wait).toBeLessThanOrEqual(MAX_WAIT_MS);
  });

  it("never busy-loops when X-RateLimit-Reset is in the past", () => {
    // Clock skew and cached responses both produce this, and a naive
    // implementation computes a negative wait and hammers the API.
    const headers = new Headers({
      "x-ratelimit-remaining": "0",
      "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) - 600),
    });
    expect(backoffMs("primary", 0, headers)).toBeGreaterThanOrEqual(1_000);
  });

  it("honours Retry-After when GitHub sends it", () => {
    const headers = new Headers({ "retry-after": "12" });
    expect(backoffMs("secondary", 0, headers)).toBe(12_000);
  });

  it("grows exponentially for secondary limits and stays bounded", () => {
    const headers = new Headers();
    const early = backoffMs("secondary", 0, headers);
    const late = backoffMs("secondary", 8, headers);
    expect(early).toBeGreaterThanOrEqual(1_000);
    expect(late).toBeLessThanOrEqual(MAX_WAIT_MS);
  });

  it("caps any wait so a request cannot hold a function open indefinitely", () => {
    const headers = new Headers({
      "x-ratelimit-remaining": "0",
      "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 86_400),
    });
    expect(backoffMs("primary", 0, headers)).toBeLessThanOrEqual(MAX_WAIT_MS);
  });
});

describe("rate limit accounting", () => {
  it("records the budget for the UI indicator", () => {
    recordRateLimit(
      new Headers({
        "x-ratelimit-limit": "5000",
        "x-ratelimit-remaining": "4321",
        "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 60),
        "x-ratelimit-resource": "core",
      }),
    );
    const snapshot = currentRateLimit();
    expect(snapshot?.remaining).toBe(4321);
    expect(snapshot?.limit).toBe(5000);
    expect(snapshot?.resource).toBe("core");
  });

  it("tolerates a response with no rate limit headers", () => {
    expect(() => recordRateLimit(new Headers())).not.toThrow();
    expect(currentRateLimit()?.remaining).toBeNull();
  });
});

describe("pagination", () => {
  it("follows rel=next and ignores the other link relations", () => {
    const link =
      '<https://api.github.com/repos/o/r/pulls?page=1>; rel="prev", ' +
      '<https://api.github.com/repos/o/r/pulls?page=3>; rel="next", ' +
      '<https://api.github.com/repos/o/r/pulls?page=9>; rel="last"';
    expect(parseNextLink(link)).toBe("/repos/o/r/pulls?page=3");
  });

  it("stops when the Link header omits rel=next, even mid-sequence", () => {
    // GitHub's Link header can stop early. A loop that synthesises page+1
    // instead of following rel=next over-runs and refetches forever.
    const lastPage = '<https://api.github.com/repos/o/r/pulls?page=1>; rel="first"';
    expect(parseNextLink(lastPage)).toBeNull();
  });

  it("returns null when there is no Link header at all", () => {
    expect(parseNextLink(null)).toBeNull();
  });

  it("returns null rather than throwing on a malformed Link header", () => {
    expect(parseNextLink('<not a url>; rel="next"')).toBeNull();
  });

  it("preserves the query string so cursor pagination keeps its cursor", () => {
    const link = '<https://api.github.com/orgs/x/repos?per_page=100&page=2&sort=pushed>; rel="next"';
    expect(parseNextLink(link)).toBe("/orgs/x/repos?per_page=100&page=2&sort=pushed");
  });
});

describe("conditional requests", () => {
  it("treats a 304 as the cached body, never as an empty result", async () => {
    // Mishandling 304 as "no data" is in the section 3.7 edge case list: it
    // silently empties a list the user is looking at.
    vi.resetModules();
    const cachedPayload = [{ number: 1, title: "cached" }];
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return new Response(JSON.stringify(cachedPayload), {
          status: 200,
          headers: { etag: 'W/"abc"', "content-type": "application/json" },
        });
      }
      return new Response(null, { status: 304, headers: { etag: 'W/"abc"' } });
    }) as unknown as typeof fetch;

    process.env.GH_TOKEN = "test-token";
    const { gh, __resetBreaker } = await import("@/lib/github/client");
    __resetBreaker();

    const first = await gh<typeof cachedPayload>("/repos/o/r/pulls");
    expect(first.data).toEqual(cachedPayload);
    expect(first.fromCache).toBe(false);

    const second = await gh<typeof cachedPayload>("/repos/o/r/pulls");
    expect(second.status).toBe(304);
    expect(second.fromCache).toBe(true);
    // The critical assertion: the body is the cached one, not null or [].
    expect(second.data).toEqual(cachedPayload);
    delete process.env.GH_TOKEN;
  });
});

describe("transient failures", () => {
  it("retries GitHub's 502 on large queries and succeeds on the retry", async () => {
    vi.resetModules();
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return new Response(JSON.stringify({ message: "Server Error" }), { status: 502 });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    process.env.GH_TOKEN = "test-token";
    const { gh, __resetBreaker } = await import("@/lib/github/client");
    __resetBreaker();

    const res = await gh<{ ok: boolean }>("/graphql-ish-large-query");
    expect(res.data).toEqual({ ok: true });
    expect(call).toBe(2);
    delete process.env.GH_TOKEN;
  });

  it("surfaces a non-JSON body as a typed error rather than a parse crash", async () => {
    vi.resetModules();
    globalThis.fetch = vi.fn(
      async () =>
        new Response("<html>gateway error</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    ) as unknown as typeof fetch;

    process.env.GH_TOKEN = "test-token";
    const { gh, GitHubError, __resetBreaker } = await import("@/lib/github/client");
    __resetBreaker();

    await expect(gh("/repos/o/r")).rejects.toBeInstanceOf(GitHubError);
    delete process.env.GH_TOKEN;
  });

  it("coalesces concurrent identical GETs into one request", async () => {
    vi.resetModules();
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 10));
      return new Response(JSON.stringify({ n: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    process.env.GH_TOKEN = "test-token";
    const { gh, __resetBreaker } = await import("@/lib/github/client");
    __resetBreaker();

    await Promise.all([gh("/repos/o/r"), gh("/repos/o/r"), gh("/repos/o/r")]);
    expect(calls).toBe(1);
    delete process.env.GH_TOKEN;
  });
});

describe("network-level failures", () => {
  it("retries a connection that never got a response, then succeeds", async () => {
    // A DNS blip or a dropped socket produces no status code at all, so it
    // cannot be classified. It is still transient, and a GET can safely repeat.
    vi.resetModules();
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("fetch failed");
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    process.env.GH_TOKEN = "test-token";
    const { gh, __resetBreaker } = await import("@/lib/github/client");
    __resetBreaker();
    vi.useFakeTimers();

    // The backoff between attempts is driven rather than slept through.
    const pending = gh<{ ok: boolean }>("/repos/o/r", { attempts: 2 });
    await vi.runAllTimersAsync();

    expect((await pending).data).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it("does not retry a POST that failed at the socket", async () => {
    // A POST may already have created a review on the server. Repeating it
    // because we never saw the response is how a duplicate comment appears.
    vi.resetModules();
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    process.env.GH_TOKEN = "test-token";
    const { gh, __resetBreaker } = await import("@/lib/github/client");
    __resetBreaker();

    await expect(
      gh("/repos/o/r/issues/1/comments", { method: "POST", body: { body: "hi" }, attempts: 3 }),
    ).rejects.toThrow(/fetch failed/);
    expect(calls).toBe(1);
  });

  it("passes an abort straight back rather than retrying the caller's own cancel", async () => {
    vi.resetModules();
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      const abort = new Error("The operation was aborted.");
      abort.name = "AbortError";
      throw abort;
    }) as unknown as typeof fetch;

    process.env.GH_TOKEN = "test-token";
    const { gh, __resetBreaker } = await import("@/lib/github/client");
    __resetBreaker();

    await expect(gh("/repos/o/r", { attempts: 3 })).rejects.toThrow(/aborted/);
    // An abort is intent, not a fault, so there is no second attempt.
    expect(calls).toBe(1);
  });
});

describe("non-JSON responses", () => {
  it("returns a raw diff as text when the caller asked for one", async () => {
    // The diff endpoint answers with a media type that is deliberately not
    // JSON; parsing it would throw on a response that is entirely correct.
    vi.resetModules();
    const diff = "diff --git a/x b/x\n+++ b/x\n+one line\n";
    globalThis.fetch = vi.fn(
      async () =>
        new Response(diff, { status: 200, headers: { "content-type": "text/plain" } }),
    ) as unknown as typeof fetch;

    process.env.GH_TOKEN = "test-token";
    const { ghData, __resetBreaker } = await import("@/lib/github/client");
    __resetBreaker();

    const body = await ghData<string>("/repos/o/r/pulls/1", {
      accept: "application/vnd.github.v3.diff",
    });
    expect(body).toBe(diff);
  });

  it("treats a 204 as an empty body rather than a parse failure", async () => {
    vi.resetModules();
    globalThis.fetch = vi.fn(
      async () => new Response(null, { status: 204 }),
    ) as unknown as typeof fetch;

    process.env.GH_TOKEN = "test-token";
    const { gh, __resetBreaker } = await import("@/lib/github/client");
    __resetBreaker();

    const res = await gh("/repos/o/r/subscription", { method: "DELETE" });
    expect(res.status).toBe(204);
    expect(res.data).toBeNull();
  });
});

describe("ETag cache bounds", () => {
  it("evicts the oldest entry rather than growing without limit", async () => {
    // The cache lives for the life of the instance. Unbounded, a long-lived
    // instance walking many repositories turns it into a memory leak.
    vi.resetModules();
    const asked: string[] = [];
    const conditional: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      asked.push(path);
      const headers = new Headers(init?.headers);
      if (headers.has("If-None-Match")) conditional.push(path);
      return new Response(JSON.stringify({ path }), {
        status: 200,
        headers: { "content-type": "application/json", etag: `W/"${path}"` },
      });
    }) as unknown as typeof fetch;

    process.env.GH_TOKEN = "test-token";
    const { gh, __resetBreaker } = await import("@/lib/github/client");
    __resetBreaker();

    // 500 is the cap, so filling it and adding one more must drop entry zero.
    for (let i = 0; i < 501; i++) await gh(`/repos/o/r/${i}`);
    expect(asked).toHaveLength(501);

    // The newest entry is still cached and sends its validator.
    await gh("/repos/o/r/500");
    expect(conditional).toContain("/repos/o/r/500");
    // The oldest was evicted, so its repeat goes out unconditionally.
    await gh("/repos/o/r/0");
    expect(conditional).not.toContain("/repos/o/r/0");
  });
});

describe("circuit breaker", () => {
  it("opens after five failures, then fails fast without touching the network", async () => {
    // The point of the breaker is that a GitHub outage degrades instead of
    // parking every request behind a 60 second backoff. Fail-fast is only
    // real if no fetch happens at all while the breaker is open.
    vi.resetModules();
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      return new Response(JSON.stringify({ message: "Internal Server Error" }), { status: 500 });
    }) as unknown as typeof fetch;

    process.env.GH_TOKEN = "test-token";
    const { gh, GitHubError, GitHubUnavailableError, __resetBreaker } = await import(
      "@/lib/github/client"
    );
    __resetBreaker();

    // A 500 is not retryable, so one call is one failure.
    for (let i = 0; i < 5; i++) {
      await expect(gh(`/repos/o/r/${i}`, { attempts: 1 })).rejects.toBeInstanceOf(GitHubError);
    }
    expect(calls).toBe(5);

    const rejection = await gh("/repos/o/r/after", { attempts: 1 }).catch((e: unknown) => e);
    expect(rejection).toBeInstanceOf(GitHubUnavailableError);
    // No sixth request: the breaker answered before the client reached fetch.
    expect(calls).toBe(5);
  });

  it("tells the caller how long the cooldown has left", async () => {
    // The retry hint is what lets a degraded UI say "back in 28 seconds"
    // instead of showing a spinner that never resolves.
    vi.resetModules();
    globalThis.fetch = vi.fn(
      async () => new Response("", { status: 500 }),
    ) as unknown as typeof fetch;

    process.env.GH_TOKEN = "test-token";
    const { gh, GitHubUnavailableError, __resetBreaker } = await import("@/lib/github/client");
    __resetBreaker();
    vi.useFakeTimers();

    for (let i = 0; i < 5; i++) {
      await gh(`/repos/o/r/${i}`, { attempts: 1 }).catch(() => null);
    }
    vi.advanceTimersByTime(5_000);

    const rejection = await gh("/repos/o/r/x", { attempts: 1 }).catch((e: unknown) => e);
    expect(rejection).toBeInstanceOf(GitHubUnavailableError);
    expect((rejection as InstanceType<typeof GitHubUnavailableError>).retryAfterMs).toBe(25_000);
  });

  it("lets a trial request through after the cooldown and closes on its success", async () => {
    // Driven with fake timers rather than a real 30 second sleep: the
    // behaviour under test is the clock comparison, not the waiting.
    vi.resetModules();
    let calls = 0;
    let failing = true;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      if (failing) return new Response("", { status: 500 });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    process.env.GH_TOKEN = "test-token";
    const { gh, GitHubError, GitHubUnavailableError, __resetBreaker } = await import(
      "@/lib/github/client"
    );
    __resetBreaker();
    vi.useFakeTimers();

    for (let i = 0; i < 5; i++) {
      await gh(`/repos/o/r/${i}`, { attempts: 1 }).catch(() => null);
    }
    await expect(gh("/repos/o/r/open", { attempts: 1 })).rejects.toBeInstanceOf(
      GitHubUnavailableError,
    );
    expect(calls).toBe(5);

    // Half-open: one trial request is allowed through once the cooldown has
    // elapsed, and it succeeding is what closes the breaker.
    vi.advanceTimersByTime(30_000);
    failing = false;
    const trial = await gh<{ ok: boolean }>("/repos/o/r/trial", { attempts: 1 });
    expect(trial.data).toEqual({ ok: true });
    expect(calls).toBe(6);

    // Closed again: the next failure is an ordinary one, not a fast fail, so
    // the counter genuinely reset rather than the cooldown merely lapsing.
    failing = true;
    await expect(gh("/repos/o/r/later", { attempts: 1 })).rejects.toBeInstanceOf(GitHubError);
    expect(calls).toBe(7);
  });

  it("does not open on a rate limit, because a busy hour is not an outage", async () => {
    // Treating a primary limit as a service fault would make the console go
    // dark exactly when it is being used hardest.
    vi.resetModules();
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      return new Response(JSON.stringify({ message: "API rate limit exceeded" }), {
        status: 403,
        headers: {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) - 600),
        },
      });
    }) as unknown as typeof fetch;

    process.env.GH_TOKEN = "test-token";
    const { gh, GitHubError, __resetBreaker } = await import("@/lib/github/client");
    __resetBreaker();

    for (let i = 0; i < 6; i++) {
      await expect(gh(`/repos/o/r/${i}`, { attempts: 1 })).rejects.toBeInstanceOf(GitHubError);
    }
    // Every one of the six reached the network: none was refused by a breaker.
    expect(calls).toBe(6);
  });
});

describe("ghPaginate", () => {
  it("follows the rel=next target and never synthesises page+1", async () => {
    // GitHub's next link is not always "the same query with page incremented":
    // it can carry a cursor. Guessing the next URL silently refetches page one.
    vi.resetModules();
    const asked: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      asked.push(`${url.pathname}${url.search}`);
      if (url.searchParams.has("after")) {
        return new Response(JSON.stringify([{ n: 3 }, { n: 4 }]), {
          status: 200,
          headers: {
            "content-type": "application/json",
            // A last page that still holds a full page of results, with no
            // rel="next": the early Link termination this must handle.
            link: '<https://api.github.com/orgs/x/repos?per_page=2>; rel="prev"',
          },
        });
      }
      return new Response(JSON.stringify([{ n: 1 }, { n: 2 }]), {
        status: 200,
        headers: {
          "content-type": "application/json",
          link: '<https://api.github.com/orgs/x/repos?per_page=2&after=cursor-xyz>; rel="next"',
        },
      });
    }) as unknown as typeof fetch;

    process.env.GH_TOKEN = "test-token";
    const { ghPaginate, __resetBreaker } = await import("@/lib/github/client");
    __resetBreaker();

    const all = await ghPaginate<{ n: number }>("/orgs/x/repos?per_page=2");

    expect(all.map((r) => r.n)).toEqual([1, 2, 3, 4]);
    // Exactly the two URLs the Link headers offered, and no invented page=3.
    expect(asked).toEqual([
      "/orgs/x/repos?per_page=2",
      "/orgs/x/repos?per_page=2&after=cursor-xyz",
    ]);
  });

  it("stops when a page arrives with no Link header at all", async () => {
    vi.resetModules();
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      return new Response(JSON.stringify([{ n: calls }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    process.env.GH_TOKEN = "test-token";
    const { ghPaginate, __resetBreaker } = await import("@/lib/github/client");
    __resetBreaker();

    expect(await ghPaginate("/orgs/x/repos")).toHaveLength(1);
    expect(calls).toBe(1);
  });

  it("stops at max so one enormous repository cannot spend the whole budget", async () => {
    vi.resetModules();
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      return new Response(JSON.stringify([{ n: calls * 2 - 1 }, { n: calls * 2 }]), {
        status: 200,
        headers: {
          "content-type": "application/json",
          // An endless sequence: only `max` can end this loop.
          link: `<https://api.github.com/orgs/x/repos?page=${calls + 1}>; rel="next"`,
        },
      });
    }) as unknown as typeof fetch;

    process.env.GH_TOKEN = "test-token";
    const { ghPaginate, __resetBreaker } = await import("@/lib/github/client");
    __resetBreaker();

    const all = await ghPaginate<{ n: number }>("/orgs/x/repos", { max: 3 });
    expect(all).toHaveLength(3);
    expect(atIndex(all, 2).n).toBe(3);
    // Two pages of two covers three, so it must not have asked for a third.
    expect(calls).toBe(2);
  });

  it("refuses a paginated endpoint that answers with an object", async () => {
    // A search endpoint wraps its results in `{ items: [...] }`. Spreading
    // that into the accumulator would produce a list of nothing useful.
    vi.resetModules();
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ items: [{ n: 1 }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;

    process.env.GH_TOKEN = "test-token";
    const { ghPaginate, GitHubError, __resetBreaker } = await import("@/lib/github/client");
    __resetBreaker();

    await expect(ghPaginate("/search/issues?q=x")).rejects.toBeInstanceOf(GitHubError);
  });
});

describe("ghGraphQL", () => {
  it("treats a GraphQL error arriving with HTTP 200 as an error", async () => {
    // GraphQL reports failures in the body with a 200 status. Trusting the
    // status code here would hand the caller an empty result set and call it
    // success, which is how a PR list silently goes blank.
    vi.resetModules();
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: null,
            errors: [{ message: "Field 'reviewDecision' doesn't exist", type: "FIELD_ERROR" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ) as unknown as typeof fetch;

    process.env.GH_TOKEN = "test-token";
    const { ghGraphQL, GitHubError, __resetBreaker } = await import("@/lib/github/client");
    __resetBreaker();

    const rejection = await ghGraphQL("query { viewer { login } }").catch((e: unknown) => e);
    expect(rejection).toBeInstanceOf(GitHubError);
    const error = rejection as InstanceType<typeof GitHubError>;
    expect(error.message).toContain("reviewDecision");
    expect(error.status).toBe(422);
    expect(error.path).toBe("/graphql");
  });

  it("maps a RATE_LIMITED body error back onto a 429", async () => {
    // The caller's rate limit handling keys on the status, and GraphQL's rate
    // limit never arrives as one, so it has to be mapped back.
    vi.resetModules();
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            errors: [{ message: "API rate limit exceeded", type: "RATE_LIMITED" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ) as unknown as typeof fetch;

    process.env.GH_TOKEN = "test-token";
    const { ghGraphQL, GitHubError, __resetBreaker } = await import("@/lib/github/client");
    __resetBreaker();

    const rejection = await ghGraphQL("query { viewer { login } }").catch((e: unknown) => e);
    // Asserted as a GitHubError, not just as something carrying a status: a
    // plain object with the right shape would otherwise pass this test.
    expect(rejection).toBeInstanceOf(GitHubError);
    expect((rejection as InstanceType<typeof GitHubError>).status).toBe(429);
  });

  it("rejects a 200 that carries neither data nor errors", async () => {
    vi.resetModules();
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;

    process.env.GH_TOKEN = "test-token";
    const { ghGraphQL, GitHubError, __resetBreaker } = await import("@/lib/github/client");
    __resetBreaker();

    const rejection = await ghGraphQL("query { viewer { login } }").catch((e: unknown) => e);
    expect(rejection).toBeInstanceOf(GitHubError);
    expect((rejection as InstanceType<typeof GitHubError>).status).toBe(502);
  });

  it("returns the data payload unwrapped on success", async () => {
    vi.resetModules();
    const sent: unknown[] = [];
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ data: { viewer: { login: "dhanika" } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    process.env.GH_TOKEN = "test-token";
    const { ghGraphQL, __resetBreaker } = await import("@/lib/github/client");
    __resetBreaker();

    const data = await ghGraphQL<{ viewer: { login: string } }>("query($n:Int!){ x }", { n: 5 });
    expect(data).toEqual({ viewer: { login: "dhanika" } });
    // Variables travel with the query rather than being interpolated into it.
    expect(atIndex(sent, 0)).toEqual({ query: "query($n:Int!){ x }", variables: { n: 5 } });
  });
});

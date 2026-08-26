// Subdomain automation talks to two third-party APIs, so the only thing worth
// testing is the decision logic: which call fires, what an already-existing
// record is allowed to look like, and, above all, that a missing token degrades
// to a documented manual instruction instead of throwing or reaching out.
//
// Every test drives a controlled fetch fake installed over the setup file's
// network blocker and torn down again, so nothing here can touch Cloudflare or
// Vercel for real.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureClientDomain,
  ensureSubdomain,
  removeClientDomain,
  removeSubdomain,
} from "@/lib/domains";
import { atIndex } from "./helpers";

// tests/setup.ts pins ROOT_DOMAIN, and lib/domains reads it once at import.
const ROOT = "example.test";

type FetchCall = { url: string; method: string; headers: Record<string, string>; body: unknown };

const calls: FetchCall[] = [];
const realFetch = globalThis.fetch;

/** Answers one request, or returns undefined to fail the test loudly. */
let respond: (call: FetchCall) => Response | undefined;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  calls.length = 0;
  respond = () => undefined;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const call: FetchCall = {
      url,
      method: init?.method ?? "GET",
      headers: (init?.headers as Record<string, string> | undefined) ?? {},
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    };
    calls.push(call);
    const res = respond(call);
    if (!res) throw new Error(`unexpected request in test: ${call.method} ${url}`);
    return res;
  }) as unknown as typeof fetch;

  // Start every test from "no integration configured" and opt in explicitly.
  vi.stubEnv("CLOUDFLARE_API_TOKEN", undefined);
  vi.stubEnv("CLOUDFLARE_ZONE_ID", undefined);
  vi.stubEnv("VERCEL_TOKEN", undefined);
  vi.stubEnv("VERCEL_TEAM_ID", undefined);
  vi.stubEnv("VERCEL_PROJECT_ID", undefined);
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllEnvs();
});

function configureCloudflare(): void {
  vi.stubEnv("CLOUDFLARE_API_TOKEN", "cf-token");
  vi.stubEnv("CLOUDFLARE_ZONE_ID", "zone-1");
}

function configureVercel(): void {
  vi.stubEnv("VERCEL_TOKEN", "vc-token");
  vi.stubEnv("VERCEL_PROJECT_ID", "prj_console");
}

/** A Cloudflare create-record success, and a Vercel attach success. */
function happyPath(call: FetchCall): Response | undefined {
  if (call.url.includes("api.cloudflare.com")) return json({ success: true, result: { id: "rec_1" } });
  if (call.url.includes("api.vercel.com")) return json({ name: "portal.example.test" }, 200);
  return undefined;
}

describe("ensureSubdomain without credentials", () => {
  it("degrades to a manual instruction and makes no request at all", async () => {
    // The repo convention: an optional integration with no token is a no-op
    // that tells the operator what to do by hand, never an exception.
    const result = await ensureSubdomain("portal");

    expect(result.status).toBe("manual_required");
    expect(result.detail).toContain("CLOUDFLARE_API_TOKEN not set");
    expect(result.detail).toContain(`portal.${ROOT}`);
    expect(result.detail).toContain("cname.vercel-dns.com");
    expect(calls).toHaveLength(0);
  });

  it("still degrades to manual when only the Vercel half is missing", async () => {
    // The Cloudflare record is created first, so this path proves the manual
    // outcome survives a partially-completed run.
    configureCloudflare();
    respond = happyPath;

    const result = await ensureSubdomain("portal");

    expect(result.status).toBe("manual_required");
    expect(result.detail).toContain("VERCEL_TOKEN / project not set");
    expect(calls).toHaveLength(1);
    expect(atIndex(calls, 0).url).toContain("/zones/zone-1/dns_records");
  });

  it("treats a configured token with no project as manual as well", async () => {
    configureCloudflare();
    vi.stubEnv("VERCEL_TOKEN", "vc-token");
    respond = happyPath;

    const result = await ensureSubdomain("portal", "");
    expect(result.status).toBe("manual_required");
  });
});

describe("ensureSubdomain create path", () => {
  it("creates an unproxied CNAME and attaches the host to the project", async () => {
    configureCloudflare();
    configureVercel();
    respond = happyPath;

    const result = await ensureSubdomain("portal");

    expect(result).toEqual({ status: "automated", detail: "cname created; domain attached" });
    expect(calls).toHaveLength(2);

    const cf = atIndex(calls, 0);
    expect(cf.method).toBe("POST");
    expect(cf.url).toBe("https://api.cloudflare.com/client/v4/zones/zone-1/dns_records");
    expect(cf.headers.Authorization).toBe("Bearer cf-token");
    // proxied:false matters: an orange-clouded record would break the Vercel
    // certificate issuance the next call depends on.
    expect(cf.body).toEqual({
      type: "CNAME",
      name: "portal",
      content: "cname.vercel-dns.com",
      proxied: false,
      ttl: 1,
      comment: "luminary-console",
    });

    const vc = atIndex(calls, 1);
    expect(vc.method).toBe("POST");
    expect(vc.url).toBe("https://api.vercel.com/v10/projects/prj_console/domains");
    expect(vc.headers.Authorization).toBe("Bearer vc-token");
    expect(vc.body).toEqual({ name: `portal.${ROOT}` });
  });

  it("attaches to a named project other than the console's own", async () => {
    // A delivered client site lives in its own Vercel project, addressed by
    // name rather than by the console's project id.
    configureCloudflare();
    configureVercel();
    respond = happyPath;

    await ensureSubdomain("ecomech", "ecomech-site");
    expect(atIndex(calls, 1).url).toContain("/projects/ecomech-site/domains");
  });

  it("scopes the Vercel call to the team when a team id is set", async () => {
    configureCloudflare();
    configureVercel();
    vi.stubEnv("VERCEL_TEAM_ID", "team_1");
    respond = happyPath;

    await ensureSubdomain("portal");
    expect(atIndex(calls, 1).url).toBe(
      "https://api.vercel.com/v10/projects/prj_console/domains?teamId=team_1",
    );
  });

  it("looks the zone up by root domain when no zone id is configured", async () => {
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "cf-token");
    configureVercel();
    respond = (call) => {
      if (call.url.includes("/zones?name=")) return json({ success: true, result: [{ id: "zone-9" }] });
      return happyPath(call);
    };

    const result = await ensureSubdomain("portal");

    expect(result.status).toBe("automated");
    expect(atIndex(calls, 0).url).toBe(`https://api.cloudflare.com/client/v4/zones?name=${ROOT}`);
    expect(atIndex(calls, 1).url).toContain("/zones/zone-9/dns_records");
  });

  it("reports an error when the zone lookup finds nothing", async () => {
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "cf-token");
    configureVercel();
    respond = () => json({ success: true, result: [] });

    const result = await ensureSubdomain("portal");

    expect(result.status).toBe("error");
    expect(result.detail).toBe(`Cloudflare zone for ${ROOT} not found`);
    // A lookup failure must not be reported as a manual instruction: nothing
    // the operator adds by hand fixes a wrong root domain.
    expect(calls).toHaveLength(1);
  });
});

describe("ensureSubdomain against an existing domain", () => {
  it("accepts Cloudflare's already-exists codes and carries on to Vercel", async () => {
    // Re-running the automation for a client whose CNAME is already there is
    // the normal case, and it has to be idempotent rather than an error.
    for (const code of [81053, 81057, 81058]) {
      calls.length = 0;
      configureCloudflare();
      configureVercel();
      respond = (call) => {
        if (call.url.includes("api.cloudflare.com")) {
          return json({ success: false, errors: [{ code, message: "record already exists" }] }, 400);
        }
        return happyPath(call);
      };

      const result = await ensureSubdomain("portal");
      expect(result).toEqual({ status: "automated", detail: "cname exists; domain attached" });
      expect(calls).toHaveLength(2);
    }
  });

  it("accepts a domain Vercel already holds", async () => {
    configureCloudflare();
    configureVercel();
    respond = (call) => {
      if (call.url.includes("api.vercel.com")) {
        return json({ error: { code: "domain_already_in_use" } }, 409);
      }
      return happyPath(call);
    };

    const result = await ensureSubdomain("portal");
    expect(result).toEqual({ status: "automated", detail: "cname created; domain already attached" });
  });

  it("accepts the domain_already_exists variant too", async () => {
    configureCloudflare();
    configureVercel();
    respond = (call) => {
      if (call.url.includes("api.vercel.com")) {
        return json({ error: { code: "domain_already_exists" } }, 409);
      }
      return happyPath(call);
    };

    expect((await ensureSubdomain("portal")).status).toBe("automated");
  });
});

describe("ensureSubdomain error handling", () => {
  it("reports an unmapped Cloudflare 4xx and never calls Vercel", async () => {
    // Attaching a host whose DNS was rejected would leave Vercel waiting on a
    // record that is never coming.
    configureCloudflare();
    configureVercel();
    respond = (call) =>
      call.url.includes("api.cloudflare.com")
        ? json({ success: false, errors: [{ code: 9103, message: "Unknown token" }] }, 403)
        : happyPath(call);

    const result = await ensureSubdomain("portal");

    expect(result.status).toBe("error");
    expect(result.detail).toContain("Cloudflare:");
    expect(result.detail).toContain("9103");
    expect(calls).toHaveLength(1);
  });

  it("treats a Cloudflare failure with no error list as an error", async () => {
    configureCloudflare();
    configureVercel();
    respond = (call) =>
      call.url.includes("api.cloudflare.com") ? json({ success: false }, 400) : happyPath(call);

    const result = await ensureSubdomain("portal");
    expect(result.status).toBe("error");
    expect(result.detail).toBe("Cloudflare: undefined");
  });

  it("reports a Vercel 4xx with its status code", async () => {
    configureCloudflare();
    configureVercel();
    respond = (call) =>
      call.url.includes("api.vercel.com")
        ? json({ error: { code: "forbidden", message: "Not authorized" } }, 403)
        : happyPath(call);

    const result = await ensureSubdomain("portal");

    expect(result.status).toBe("error");
    expect(result.detail).toContain("Vercel domains: 403");
    expect(result.detail).toContain("forbidden");
  });

  it("survives a Vercel error body that is not JSON", async () => {
    // Vercel's edge returns an HTML page for some failures, and parsing that as
    // JSON must not replace the real status code with a parse error.
    configureCloudflare();
    configureVercel();
    respond = (call) =>
      call.url.includes("api.vercel.com")
        ? new Response("<html>bad gateway</html>", { status: 502 })
        : happyPath(call);

    const result = await ensureSubdomain("portal");

    expect(result.status).toBe("error");
    expect(result.detail).toContain("Vercel domains: 502");
  });

  it("reports a transport failure rather than throwing at the caller", async () => {
    configureCloudflare();
    configureVercel();
    respond = () => undefined; // the fake throws for an unanswered request

    const result = await ensureSubdomain("portal");
    expect(result.status).toBe("error");
    expect(result.detail).toContain("unexpected request in test");
  });

  it("stringifies a rejection that is not an Error", async () => {
    // A non-Error rejection has no `.message`, so reading one blindly would
    // report "undefined" as the reason the subdomain could not be set up.
    configureCloudflare();
    configureVercel();
    globalThis.fetch = (async () => {
      throw "socket closed";
    }) as unknown as typeof fetch;

    const result = await ensureSubdomain("portal");
    expect(result).toEqual({ status: "error", detail: "socket closed" });
  });
});

describe("removeSubdomain", () => {
  it("degrades to two manual notes with no credentials and no requests", async () => {
    const notes = await removeSubdomain("portal");

    expect(notes).toHaveLength(2);
    // Each note names the variable that is actually absent, so the operator
    // knows which one to set rather than guessing.
    expect(atIndex(notes, 0)).toContain("CLOUDFLARE_API_TOKEN");
    expect(atIndex(notes, 1)).toContain("vercel token missing");
    expect(calls).toHaveLength(0);
  });

  it("deletes every matching Cloudflare record and detaches the domain", async () => {
    configureCloudflare();
    configureVercel();
    respond = (call) => {
      if (call.url.includes("dns_records?name=")) return json({ result: [{ id: "rec_1" }] });
      if (call.url.includes("dns_records/")) return json({ success: true });
      return new Response(null, { status: 200 });
    };

    const notes = await removeSubdomain("portal");

    expect(notes).toEqual(["cloudflare record deleted", "vercel domain detached"]);
    expect(atIndex(calls, 0).url).toBe(
      `https://api.cloudflare.com/client/v4/zones/zone-1/dns_records?name=portal.${ROOT}`,
    );
    expect(atIndex(calls, 1)).toMatchObject({
      url: "https://api.cloudflare.com/client/v4/zones/zone-1/dns_records/rec_1",
      method: "DELETE",
    });
    expect(atIndex(calls, 2)).toMatchObject({
      url: `https://api.vercel.com/v9/projects/prj_console/domains/portal.${ROOT}`,
      method: "DELETE",
    });
  });

  it("deletes each of several records for the same host", async () => {
    // A stale A record alongside the CNAME would otherwise keep resolving.
    configureCloudflare();
    respond = (call) => {
      if (call.url.includes("dns_records?name=")) {
        return json({ result: [{ id: "rec_1" }, { id: "rec_2" }] });
      }
      return json({ success: true });
    };

    const notes = await removeSubdomain("portal");

    expect(notes.filter((n) => n === "cloudflare record deleted")).toHaveLength(2);
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual([
      "https://api.cloudflare.com/client/v4/zones/zone-1/dns_records/rec_1",
      "https://api.cloudflare.com/client/v4/zones/zone-1/dns_records/rec_2",
    ]);
  });

  it("says so when there was no record to remove", async () => {
    configureCloudflare();
    respond = () => json({ result: [] });

    const notes = await removeSubdomain("portal");
    expect(notes).toContain("no cloudflare record");
    expect(calls).toHaveLength(1);
  });

  it("tolerates a Cloudflare response with no result field", async () => {
    configureCloudflare();
    respond = () => json({ success: true });

    expect(await removeSubdomain("portal")).toContain("no cloudflare record");
  });

  it("looks the zone up on removal when only the token is set, as creation does", async () => {
    // Removal used to require CLOUDFLARE_ZONE_ID while creation fell back to a
    // lookup by name. A deployment holding only the token could therefore
    // create DNS records it was unable to delete, and the note it emitted
    // blamed a missing token that was in fact present.
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "cf-token");
    respond = (call) => {
      if (call.url.includes("/zones?name=")) return json({ result: [{ id: "zone-1" }] });
      if (call.url.includes("/dns_records?name=")) return json({ result: [{ id: "rec-1" }] });
      return new Response(null, { status: 200 });
    };

    const notes = await removeSubdomain("portal");
    expect(notes).toContain("cloudflare record deleted");
    expect(calls.some((c) => c.url.includes("/zones?name="))).toBe(true);
  });

  it("names the variable that is actually missing", async () => {
    // With no token at all there is nothing to look up, and the note has to
    // point at the right thing for the operator to act on it.
    const notes = await removeSubdomain("portal");
    expect(atIndex(notes, 0)).toContain("CLOUDFLARE_API_TOKEN");
    expect(calls).toHaveLength(0);
  });

  it("records the Vercel status code when the detach is refused", async () => {
    configureVercel();
    respond = () => new Response(null, { status: 404 });

    const notes = await removeSubdomain("portal");
    expect(notes).toContain("vercel: 404");
  });

  it("scopes the detach to the team when a team id is set", async () => {
    configureVercel();
    vi.stubEnv("VERCEL_TEAM_ID", "team_1");
    respond = () => new Response(null, { status: 200 });

    await removeSubdomain("portal");
    expect(atIndex(calls, 0).url).toBe(
      `https://api.vercel.com/v9/projects/prj_console/domains/portal.${ROOT}?teamId=team_1`,
    );
  });

  it("keeps going and reports when a transport call fails", async () => {
    // Teardown is best-effort cleanup: one dead API must not stop the other,
    // and the caller gets notes rather than an exception.
    configureCloudflare();
    configureVercel();
    respond = () => undefined; // the fake throws for an unanswered request

    const notes = await removeSubdomain("portal");

    expect(notes).toHaveLength(2);
    expect(atIndex(notes, 0)).toContain("cloudflare:");
    expect(atIndex(notes, 1)).toContain("vercel:");
  });
});

describe("client portal helpers", () => {
  it("points a client's portal subdomain at the console's own project", async () => {
    configureCloudflare();
    configureVercel();
    respond = happyPath;

    const result = await ensureClientDomain("ecomech");

    expect(result.status).toBe("automated");
    expect(atIndex(calls, 0).body).toMatchObject({ name: "ecomech" });
    expect(atIndex(calls, 1).url).toContain("/projects/prj_console/domains");
    expect(atIndex(calls, 1).body).toEqual({ name: `ecomech.${ROOT}` });
  });

  it("tears the same portal subdomain down again", async () => {
    configureCloudflare();
    configureVercel();
    respond = (call) => {
      if (call.url.includes("dns_records?name=")) return json({ result: [{ id: "rec_1" }] });
      return new Response(null, { status: 200 });
    };

    const notes = await removeClientDomain("ecomech");

    expect(notes).toEqual(["cloudflare record deleted", "vercel domain detached"]);
    expect(atIndex(calls, 0).url).toContain(`dns_records?name=ecomech.${ROOT}`);
  });

  it("degrades to manual for a client portal with no tokens", async () => {
    const result = await ensureClientDomain("ecomech");
    expect(result.status).toBe("manual_required");
    expect(calls).toHaveLength(0);
  });
});

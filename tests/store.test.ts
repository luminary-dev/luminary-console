// LC-001 cover for the client index.
//
// The whole finding is one confusion: "there is no index yet" and "the index
// is there but I could not read it" used to produce the same value, [], and
// the next saveClient wrote that [] back with a single entry in it. These
// tests hold the two apart, and check that the leniency the small state files
// rely on is still exactly where it was.
//
// The S3 SDK is mocked with an in-memory bucket, so nothing here can reach R2
// (tests/setup.ts already blocks fetch and points the credentials at a dead
// endpoint; this is the second lock).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientRecord } from "@/lib/types";

const INDEX_KEY = "console/index.json";
const recordKey = (slug: string) => `console/clients/${slug}/record.json`;

// vi.hoisted: the vi.mock factory below is lifted above the imports, so it
// cannot close over anything declared normally.
const r2 = vi.hoisted(() => {
  const objects = new Map<string, { body: string; etag: string }>();
  let seq = 0;
  const nextEtag = () => `"etag-${++seq}"`;
  return {
    objects,
    nextEtag,
    /** Write straight into the bucket, bypassing the store under test. */
    put(key: string, body: string) {
      objects.set(key, { body, etag: nextEtag() });
    },
    read(key: string): string | undefined {
      return objects.get(key)?.body;
    },
    reset() {
      objects.clear();
      seq = 0;
    },
  };
});

vi.mock("@aws-sdk/client-s3", () => {
  const fail = (name: string, status: number) =>
    Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });

  class GetObjectCommand {
    readonly kind = "get";
    constructor(public input: any) {}
  }
  class PutObjectCommand {
    readonly kind = "put";
    constructor(public input: any) {}
  }
  class DeleteObjectCommand {
    readonly kind = "delete";
    constructor(public input: any) {}
  }
  class DeleteObjectsCommand {
    readonly kind = "deleteMany";
    constructor(public input: any) {}
  }
  class ListObjectsV2Command {
    readonly kind = "list";
    constructor(public input: any) {}
  }

  class S3Client {
    constructor(public config: unknown) {}
    async send(command: any): Promise<any> {
      const key = String(command.input.Key ?? "");
      switch (command.kind) {
        case "get": {
          const object = r2.objects.get(key);
          if (!object) throw fail("NoSuchKey", 404);
          return {
            ETag: object.etag,
            ContentType: "application/json",
            Body: { transformToString: async () => object.body },
          };
        }
        case "put": {
          const current = r2.objects.get(key);
          if (command.input.IfNoneMatch === "*" && current) throw fail("PreconditionFailed", 412);
          if (command.input.IfMatch && current?.etag !== command.input.IfMatch) {
            throw fail("PreconditionFailed", 412);
          }
          const etag = r2.nextEtag();
          r2.objects.set(key, { body: String(command.input.Body), etag });
          return { ETag: etag };
        }
        case "delete":
          r2.objects.delete(key);
          return {};
        case "deleteMany":
          for (const o of command.input.Delete.Objects) r2.objects.delete(String(o.Key));
          return {};
        case "list": {
          const prefix = String(command.input.Prefix ?? "");
          return {
            Contents: [...r2.objects.keys()].filter((k) => k.startsWith(prefix)).map((Key) => ({ Key })),
            IsTruncated: false,
          };
        }
        default:
          throw new Error(`unexpected command: ${String(command.kind)}`);
      }
    }
  }

  return {
    S3Client,
    GetObjectCommand,
    PutObjectCommand,
    DeleteObjectCommand,
    DeleteObjectsCommand,
    ListObjectsV2Command,
  };
});

/** A fresh module per test, so the 5s read cache never leaks between them. */
const loadStore = async () => {
  vi.resetModules();
  return import("@/lib/store");
};

function makeRecord(slug: string, docNoBase = "0044"): ClientRecord {
  return {
    slug,
    company: `${slug} Ltd`,
    brief: "a brief",
    projectLabel: "Website",
    docNoBase,
    status: "created",
    createdAt: "2026-08-26T00:00:00.000Z",
    domain: `${slug}.example.test`,
    dnsStatus: "automated",
    extraQuestions: [],
    docs: {},
  };
}

const indexEntry = (slug: string, docNoBase = "0044") => ({
  slug,
  company: `${slug} Ltd`,
  status: "created",
  createdAt: "2026-08-26T00:00:00.000Z",
  docNoBase,
});

const storedIndex = () => JSON.parse(r2.read(INDEX_KEY) ?? "null");

beforeEach(() => {
  r2.reset();
});

describe("client index reads", () => {
  it("LC-001: reports an empty index only when the index has never been written", async () => {
    const store = await loadStore();
    expect(await store.getIndex()).toEqual([]);
  });

  it("LC-001: throws rather than reporting empty when the index will not parse", async () => {
    const store = await loadStore();
    r2.put(INDEX_KEY, '[{"slug":"eco-mech"');

    await expect(store.getIndex()).rejects.toBeInstanceOf(store.StoreReadError);
    await expect(store.getIndex()).rejects.toThrow(/index\.json/);
  });

  it("LC-001: throws when the index parses to something that is not an array", async () => {
    const store = await loadStore();
    r2.put(INDEX_KEY, '{"clients":[]}');

    await expect(store.getIndex()).rejects.toBeInstanceOf(store.StoreReadError);
  });

  it("LC-001: does not cache a failed read as an empty index", async () => {
    const store = await loadStore();
    r2.put(INDEX_KEY, "not json at all");

    await expect(store.getIndex()).rejects.toBeInstanceOf(store.StoreReadError);
    // A second call inside the 5s cache window must fail the same way rather
    // than serving a cached null that reads as [].
    await expect(store.getIndex()).rejects.toBeInstanceOf(store.StoreReadError);
  });
});

describe("saveClient against the index", () => {
  it("LC-001: refuses to write an index it could not read", async () => {
    const store = await loadStore();
    const corrupt = '[{"slug":"eco-mech","company":"Eco Mech"';
    r2.put(INDEX_KEY, corrupt);

    await expect(store.saveClient(makeRecord("acme"))).rejects.toBeInstanceOf(store.StoreReadError);

    // The old behaviour replaced the whole index with a single entry. The
    // corrupt bytes must still be there, untouched, for recovery.
    expect(r2.read(INDEX_KEY)).toBe(corrupt);
    // And nothing else may have landed: the index is checked before the record
    // is written, so the store is left exactly as it was found.
    expect(r2.objects.has(recordKey("acme"))).toBe(false);
  });

  it("LC-001: saves the first client correctly when the index is genuinely absent", async () => {
    const store = await loadStore();

    await store.saveClient(makeRecord("acme"));

    expect(storedIndex()).toEqual([indexEntry("acme")]);
    expect(JSON.parse(r2.read(recordKey("acme")) ?? "null").slug).toBe("acme");
    expect(await store.getIndex()).toHaveLength(1);
  });

  it("LC-001: keeps every other entry when one client is saved", async () => {
    const store = await loadStore();
    r2.put(
      INDEX_KEY,
      JSON.stringify([indexEntry("eco-mech", "0043"), indexEntry("beta", "0044"), indexEntry("gamma", "0045")]),
    );

    await store.saveClient(makeRecord("acme", "0046"));

    expect(storedIndex().map((e: { slug: string }) => e.slug)).toEqual([
      "eco-mech",
      "beta",
      "gamma",
      "acme",
    ]);
  });

  it("LC-001: updates an existing entry in place instead of appending a duplicate", async () => {
    const store = await loadStore();
    await store.saveClient(makeRecord("acme"));

    const moved = { ...makeRecord("acme"), status: "drafts_ready" as const, company: "Acme Renamed" };
    await store.saveClient(moved);

    const index = storedIndex();
    expect(index).toHaveLength(1);
    expect(index[0].status).toBe("drafts_ready");
    expect(index[0].company).toBe("Acme Renamed");
  });
});

describe("deleteClient against the index", () => {
  it("LC-001: refuses to delete anything when the index could not be read", async () => {
    const store = await loadStore();
    await store.saveClient(makeRecord("acme"));
    r2.put(INDEX_KEY, "}{");

    await expect(store.deleteClient("acme")).rejects.toBeInstanceOf(store.StoreReadError);

    // The client's objects survive: a corrupt index must not turn a delete
    // into a half-delete that the index can never be reconciled against.
    expect(r2.objects.has(recordKey("acme"))).toBe(true);
  });

  it("LC-001: removes only its own entry and reports the object count", async () => {
    const store = await loadStore();
    await store.saveClient(makeRecord("acme"));
    await store.saveClient(makeRecord("beta"));
    r2.put("console/clients/acme/docs/quotation.pdf", "pdf bytes");

    const deleted = await store.deleteClient("acme");

    expect(deleted).toBe(2);
    expect(storedIndex().map((e: { slug: string }) => e.slug)).toEqual(["beta"]);
    expect(r2.objects.has(recordKey("beta"))).toBe(true);
  });
});

describe("state collections", () => {
  it("LC-001: listState enumerates one-object-per-item state keys without caching", async () => {
    const store = await loadStore();

    expect(await store.listState("github/deliveries/")).toEqual([]);

    r2.put("console/state/github/deliveries/d1.json", "{}");
    r2.put("console/state/github/deliveries/d2.json", "{}");
    r2.put("console/state/activity.json", "[]");

    expect((await store.listState("github/deliveries/")).sort()).toEqual([
      "console/state/github/deliveries/d1.json",
      "console/state/github/deliveries/d2.json",
    ]);

    // A key written after the first listing must show up on the next one, so
    // a burst of deliveries is never hidden behind a cached listing.
    r2.put("console/state/github/deliveries/d3.json", "{}");
    expect(await store.listState("github/deliveries/")).toHaveLength(3);
  });
});

describe("reads that stay lenient on purpose", () => {
  it("LC-001: a corrupt state file still falls back to null for readState", async () => {
    const store = await loadStore();
    r2.put("console/state/activity.json", "truncated[");

    // Activity, sessions, push subscriptions and OTP all treat "no file" and
    // "unreadable file" as the same start-from-nothing case, and rewrite the
    // whole file. Changing that here would break them.
    expect(await store.readState("activity.json")).toBeNull();
  });

  it("LC-001: a corrupt client record still reads as no such client", async () => {
    const store = await loadStore();
    r2.put(recordKey("acme"), '{"slug":"acme"');

    expect(await store.getClient("acme")).toBeNull();
  });

  it("LC-001: a real store outage still surfaces instead of reading as empty", async () => {
    const store = await loadStore();
    const outage = Object.assign(new Error("connection reset"), { $metadata: { httpStatusCode: 500 } });
    r2.objects.set(INDEX_KEY, {
      get body(): string {
        throw outage;
      },
      etag: '"etag-outage"',
    });

    await expect(store.getIndex()).rejects.toThrow(/connection reset|index\.json/);
  });
});

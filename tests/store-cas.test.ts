// LC-002 cover for compare-and-swap on the shared objects.
//
// Two operators, two tabs, the ops relay and a portal action all write through
// the same read-modify-write. Without a precondition on the write, whoever
// finishes last silently erases whatever the other one did, and two client
// creations can be issued the same doc number. These tests drive real races
// against an in-memory bucket that enforces If-Match and If-None-Match the way
// R2 does, so nothing here touches the network.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientRecord, IndexEntry } from "@/lib/types";
import { atIndex } from "./helpers";

const INDEX_KEY = "console/index.json";
const COUNTER_KEY = "console/counter.json";
const recordKey = (slug: string) => `console/clients/${slug}/record.json`;

const r2 = vi.hoisted(() => {
  const objects = new Map<string, { body: string; etag: string }>();
  const calls: { kind: string; input: Record<string, unknown> }[] = [];
  const hooks: {
    /** Runs just before a put is evaluated, which is where a competing writer
     *  is injected: it lands between our read and our write. */
    beforePut: ((key: string, input: Record<string, unknown>) => void) | null;
  } = { beforePut: null };
  let seq = 0;
  const nextEtag = () => `"etag-${++seq}"`;
  return {
    objects,
    calls,
    hooks,
    nextEtag,
    put(key: string, body: string) {
      objects.set(key, { body, etag: nextEtag() });
    },
    read(key: string): string | undefined {
      return objects.get(key)?.body;
    },
    puts(key: string) {
      return calls.filter((c) => c.kind === "put" && c.input.Key === key);
    },
    reset() {
      objects.clear();
      calls.length = 0;
      hooks.beforePut = null;
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
      // Yield first, so concurrent callers really do interleave rather than
      // running to completion one after the other.
      await Promise.resolve();
      const key = String(command.input.Key ?? "");
      r2.calls.push({ kind: command.kind, input: command.input });
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
          r2.hooks.beforePut?.(key, command.input);
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

const indexEntry = (slug: string): IndexEntry => ({
  slug,
  company: `${slug} Ltd`,
  status: "created",
  createdAt: "2026-08-26T00:00:00.000Z",
  docNoBase: "0044",
});

const storedIndex = (): IndexEntry[] => JSON.parse(r2.read(INDEX_KEY) ?? "[]");
const storedSlugs = () => storedIndex().map((e) => e.slug).sort();

/** A competing writer landing between our read and our write. */
function raceIndex(times: number, slug: string) {
  let left = times;
  r2.hooks.beforePut = (key) => {
    if (key !== INDEX_KEY || left <= 0) return;
    left--;
    const current: IndexEntry[] = JSON.parse(r2.read(INDEX_KEY) ?? "[]");
    r2.put(INDEX_KEY, JSON.stringify([...current, indexEntry(`${slug}-${left}`)]));
  };
}

beforeEach(() => {
  r2.reset();
});

describe("conditional writes", () => {
  it("LC-002: creates the index with If-None-Match and updates it with If-Match", async () => {
    const store = await loadStore();

    await store.saveClient(makeRecord("acme"));
    await store.saveClient(makeRecord("beta"));

    const puts = r2.puts(INDEX_KEY);
    const create = atIndex(puts, 0);
    const update = atIndex(puts, 1);
    expect(create.input.IfNoneMatch).toBe("*");
    expect(create.input.IfMatch).toBeUndefined();
    expect(String(update.input.IfMatch)).toMatch(/^"etag-/);
    expect(update.input.IfNoneMatch).toBeUndefined();
  });

  it("LC-002: updateJson re-runs the mutation against the value the winner wrote", async () => {
    const store = await loadStore();
    r2.put("console/state/demo.json", JSON.stringify({ n: 1 }));

    const seen: (number | null)[] = [];
    let raced = false;
    r2.hooks.beforePut = (key) => {
      if (key !== "console/state/demo.json" || raced) return;
      raced = true;
      r2.put("console/state/demo.json", JSON.stringify({ n: 10 }));
    };

    const result = await store.updateState<{ n: number }>("demo.json", (current) => {
      seen.push(current?.n ?? null);
      return { n: (current?.n ?? 0) + 1 };
    });

    // First attempt saw 1 and lost; the retry saw the winner's 10 and built on
    // it, so the other writer's change survives.
    expect(seen).toEqual([1, 10]);
    expect(result).toEqual({ n: 11 });
    expect(JSON.parse(r2.read("console/state/demo.json") ?? "null")).toEqual({ n: 11 });
  });

  it("LC-002: two racing creators of the same missing object cannot both be first", async () => {
    const store = await loadStore();

    const results = await Promise.all([
      store.updateState<string[]>("collection.json", (c) => [...(c ?? []), "a"]),
      store.updateState<string[]>("collection.json", (c) => [...(c ?? []), "b"]),
    ]);

    expect(results.some((r) => r.length === 2)).toBe(true);
    expect(JSON.parse(r2.read("console/state/collection.json") ?? "[]").sort()).toEqual(["a", "b"]);
  });
});

describe("saveClient under contention", () => {
  it("LC-002: a save that loses the race retries and keeps both writers' entries", async () => {
    const store = await loadStore();
    await store.saveClient(makeRecord("acme"));
    raceIndex(1, "portal");

    await store.saveClient(makeRecord("beta"));

    // Before the fix the second save wrote the copy it had read, erasing the
    // entry the other writer added in between.
    expect(storedSlugs()).toEqual(["acme", "beta", "portal-0"]);
    expect(r2.puts(INDEX_KEY)).toHaveLength(3); // create, the losing attempt, the retry
  });

  it("LC-002: survives several consecutive losses inside the retry budget", async () => {
    const store = await loadStore();
    await store.saveClient(makeRecord("acme"));
    raceIndex(4, "relay");

    await store.saveClient(makeRecord("beta"));

    expect(storedSlugs()).toEqual(["acme", "beta", "relay-0", "relay-1", "relay-2", "relay-3"]);
  });

  it("LC-002: exhausted retries throw StoreConflictError instead of losing the write", async () => {
    const store = await loadStore();
    await store.saveClient(makeRecord("acme"));
    raceIndex(Number.MAX_SAFE_INTEGER, "relay");

    const err = await store.saveClient(makeRecord("beta")).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(store.StoreConflictError);
    expect((err as InstanceType<typeof store.StoreConflictError>).attempts).toBe(5);
    expect((err as Error).message).toMatch(/index\.json/);
    // The loser's entry is absent because its write never landed, which is the
    // point: a lost write has to be reported, not swallowed.
    expect(storedSlugs()).not.toContain("beta");
  });

  it("LC-002: an expectedEtag turns the record write into a compare-and-swap", async () => {
    const store = await loadStore();
    await store.saveClient(makeRecord("acme"));

    const { record, etag } = await store.getClientWithEtag("acme");
    expect(record?.slug).toBe("acme");
    expect(etag).toBeTruthy();

    // Someone else saves the same client while this operator is editing.
    await store.saveClient({ ...makeRecord("acme"), notes: "written by the other tab" });

    const stale = { ...makeRecord("acme"), notes: "written by this tab" };
    await expect(
      store.saveClient(stale, { ...(etag !== undefined ? { expectedEtag: etag } : {}) }),
    ).rejects.toBeInstanceOf(
      store.StoreConflictError,
    );
    expect(JSON.parse(r2.read(recordKey("acme")) ?? "null").notes).toBe("written by the other tab");
  });

  it("LC-002: an ordinary save is unchanged for the existing call sites", async () => {
    const store = await loadStore();

    await store.saveClient(makeRecord("acme"));
    await store.saveClient({ ...makeRecord("acme"), notes: "second write" });

    expect(r2.puts(recordKey("acme")).every((c) => !c.input.IfMatch)).toBe(true);
    expect(JSON.parse(r2.read(recordKey("acme")) ?? "null").notes).toBe("second write");
  });
});

describe("doc numbers under contention", () => {
  it("LC-002: concurrent creations never receive the same doc number", async () => {
    const store = await loadStore();

    const issued = await Promise.all([
      store.nextDocNoBase(),
      store.nextDocNoBase(),
      store.nextDocNoBase(),
      store.nextDocNoBase(),
    ]);

    expect([...issued].sort()).toEqual(["0044", "0045", "0046", "0047"]);
    expect(new Set(issued).size).toBe(4);
    expect(JSON.parse(r2.read(COUNTER_KEY) ?? "null")).toEqual({ last: 47 });
    // More puts than callers proves the race was real and was resolved by
    // retrying, not by the four calls happening to run one after another.
    expect(r2.puts(COUNTER_KEY).length).toBeGreaterThan(4);
  });

  it("LC-002: takes the number after the one a competing writer just issued", async () => {
    const store = await loadStore();
    r2.put(COUNTER_KEY, JSON.stringify({ last: 50 }));
    let raced = false;
    r2.hooks.beforePut = (key) => {
      if (key !== COUNTER_KEY || raced) return;
      raced = true;
      r2.put(COUNTER_KEY, JSON.stringify({ last: 60 }));
    };

    expect(await store.nextDocNoBase()).toBe("0061");
  });

  it("LC-002: the counter is never read from the 5s cache", async () => {
    const store = await loadStore();

    await store.nextDocNoBase();
    r2.put(COUNTER_KEY, JSON.stringify({ last: 99 })); // another instance moved it
    const second = await store.nextDocNoBase();

    // A cached counter would hand out 45 again. It has to see 99.
    expect(second).toBe("0100");
  });

  it("LC-002: seedDocCounter raises the counter without lowering a concurrent bump", async () => {
    const store = await loadStore();
    r2.put(COUNTER_KEY, JSON.stringify({ last: 10 }));
    let raced = false;
    r2.hooks.beforePut = (key) => {
      if (key !== COUNTER_KEY || raced) return;
      raced = true;
      r2.put(COUNTER_KEY, JSON.stringify({ last: 200 }));
    };

    expect(await store.seedDocCounter(120)).toBe(200);
  });
});

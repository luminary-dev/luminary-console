// The audit log is the only record of who did what, and it is deliberately
// best-effort: a store outage must lose the log line, never the action that was
// being logged. These tests hold that contract, the 500-entry cap, the
// newest-first ordering the dashboard depends on, and the notification marks.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A stand-in for R2. `failRead` / `failWrite` turn it into an outage, which is
// the interesting half of a module whose whole promise is "never throws".
const store = vi.hoisted(() => {
  const objects = new Map<string, unknown>();
  const state = { failRead: false, failWrite: false };
  return {
    objects,
    state,
    reset() {
      objects.clear();
      state.failRead = false;
      state.failWrite = false;
    },
  };
});

vi.mock("@/lib/store", () => ({
  readState: vi.fn(async (path: string) => {
    if (store.state.failRead) throw new Error("R2 is unreachable");
    return store.objects.has(path) ? structuredClone(store.objects.get(path)) : null;
  }),
  writeState: vi.fn(async (path: string, data: unknown) => {
    if (store.state.failWrite) throw new Error("R2 rejected the write");
    store.objects.set(path, structuredClone(data));
  }),
}));

import {
  CLIENT_ACTIONS,
  activityFor,
  entryKey,
  getClientSeenAt,
  getNotificationsSeenAt,
  getReadKeys,
  isClientEvent,
  isNotifiable,
  logActivity,
  markClientSeen,
  markEntryRead,
  markNotificationsSeen,
  recentActivity,
  type ActivityEntry,
} from "@/lib/activity";
import { atIndex } from "./helpers";

const PATH = "activity.json";
const NOTIF_PATH = "notifications.json";
const CLIENT_SEEN_PATH = "activity_seen.json";

function entry(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    at: "2026-08-20T10:00:00.000Z",
    actor: "dhanika@luminary.dev",
    action: "published quotation",
    target: "ecomech",
    ...overrides,
  };
}

function stored(): ActivityEntry[] {
  return (store.objects.get(PATH) as ActivityEntry[] | undefined) ?? [];
}

let errors: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  store.reset();
  // Every swallowed failure logs, so the spy both silences the run and gives
  // the tests something to assert the swallow actually happened.
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errors.mockRestore();
  vi.useRealTimers();
});

describe("appending entries", () => {
  it("records actor, action, target and an ISO timestamp", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-26T09:15:00.000Z"));

    await logActivity("dhanika@luminary.dev", "published quotation", "ecomech");

    const entries = stored();
    expect(entries).toHaveLength(1);
    expect(atIndex(entries, 0)).toEqual({
      at: "2026-08-26T09:15:00.000Z",
      actor: "dhanika@luminary.dev",
      action: "published quotation",
      target: "ecomech",
    });
  });

  it("omits the detail key entirely when there is no detail", async () => {
    // The key is spread in conditionally, so an absent detail must not land as
    // `detail: undefined` in the stored JSON.
    await logActivity("operator", "signed in", "console");
    expect("detail" in atIndex(stored(), 0)).toBe(false);
  });

  it("keeps a detail when one is given, and drops an empty one", async () => {
    await logActivity("operator", "sent email", "ecomech", "quotation ready");
    await logActivity("operator", "sent email", "aurora", "");

    expect(atIndex(stored(), 0).detail).toBe("quotation ready");
    expect("detail" in atIndex(stored(), 1)).toBe(false);
  });

  it("appends to what is already stored rather than replacing it", async () => {
    store.objects.set(PATH, [entry({ action: "created client" })]);
    await logActivity("operator", "published quotation", "ecomech");

    expect(stored()).toHaveLength(2);
    expect(atIndex(stored(), 0).action).toBe("created client");
    expect(atIndex(stored(), 1).action).toBe("published quotation");
  });

  it("caps the log at the newest 500 entries", async () => {
    // The log lives in one object that is rewritten in full, so an uncapped
    // append would grow the write until it stops fitting.
    const seed = Array.from({ length: 500 }, (_, i) =>
      entry({ action: `action ${i}`, at: `2026-08-01T00:00:${String(i % 60).padStart(2, "0")}.000Z` }),
    );
    store.objects.set(PATH, seed);

    await logActivity("operator", "the newest thing", "ecomech");

    const entries = stored();
    expect(entries).toHaveLength(500);
    // The oldest entry is the one that fell off the front.
    expect(atIndex(entries, 0).action).toBe("action 1");
    expect(atIndex(entries, 499).action).toBe("the newest thing");
  });

  it("swallows a store write failure instead of breaking the logged action", async () => {
    store.state.failWrite = true;
    await expect(logActivity("operator", "published quotation", "ecomech")).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalled();
    expect(store.objects.has(PATH)).toBe(false);
  });

  it("swallows a store read failure", async () => {
    store.state.failRead = true;
    await expect(logActivity("operator", "published quotation", "ecomech")).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalled();
  });

  it("swallows malformed stored state and leaves it untouched", async () => {
    // If the object were ever overwritten with something that is not an array,
    // the append must fail closed rather than throw into the caller.
    store.objects.set(PATH, { not: "an array" });
    await expect(logActivity("operator", "published quotation", "ecomech")).resolves.toBeUndefined();
    expect(store.objects.get(PATH)).toEqual({ not: "an array" });
  });
});

describe("reading entries", () => {
  const feed: ActivityEntry[] = [
    entry({ at: "2026-08-20T10:00:00.000Z", action: "created client", target: "ecomech" }),
    entry({ at: "2026-08-21T10:00:00.000Z", action: "published quotation", target: "aurora" }),
    entry({ at: "2026-08-22T10:00:00.000Z", action: "signed in", target: "console" }),
    entry({ at: "2026-08-23T10:00:00.000Z", action: "accepted quotation", target: "ecomech" }),
  ];

  it("returns the newest entry first", async () => {
    // The store holds the log oldest-first; every reader shows newest-first.
    store.objects.set(PATH, feed);
    const entries = await recentActivity();
    expect(entries.map((e) => e.at)).toEqual([
      "2026-08-23T10:00:00.000Z",
      "2026-08-22T10:00:00.000Z",
      "2026-08-21T10:00:00.000Z",
      "2026-08-20T10:00:00.000Z",
    ]);
  });

  it("takes the newest entries when a limit is given, not the oldest", async () => {
    store.objects.set(PATH, feed);
    const entries = await recentActivity(2);
    expect(entries).toHaveLength(2);
    expect(atIndex(entries, 0).at).toBe("2026-08-23T10:00:00.000Z");
    expect(atIndex(entries, 1).at).toBe("2026-08-22T10:00:00.000Z");
  });

  it("returns an empty list when nothing has been logged", async () => {
    expect(await recentActivity()).toEqual([]);
    expect(await activityFor("ecomech")).toEqual([]);
  });

  it("filters a client feed by target, newest first", async () => {
    store.objects.set(PATH, feed);
    const entries = await activityFor("ecomech");
    expect(entries.map((e) => e.action)).toEqual(["accepted quotation", "created client"]);
  });

  it("limits a client feed after filtering, not before", async () => {
    // Slicing before the filter would return fewer than `limit` matches, or
    // none at all when the newest entries all belong to other clients.
    store.objects.set(PATH, [
      ...feed,
      entry({ at: "2026-08-24T10:00:00.000Z", action: "sent invoice", target: "aurora" }),
      entry({ at: "2026-08-25T10:00:00.000Z", action: "sent invoice", target: "aurora" }),
    ]);
    const entries = await activityFor("ecomech", 1);
    expect(entries).toHaveLength(1);
    expect(atIndex(entries, 0).action).toBe("accepted quotation");
  });

  it("returns nothing for a client with no entries", async () => {
    store.objects.set(PATH, feed);
    expect(await activityFor("unknown-slug")).toEqual([]);
  });

  it("degrades to an empty feed when the store read fails", async () => {
    store.state.failRead = true;
    expect(await recentActivity()).toEqual([]);
    expect(await activityFor("ecomech")).toEqual([]);
    expect(errors).toHaveBeenCalledTimes(2);
  });

  it("degrades to an empty feed on malformed stored state", async () => {
    // A dashboard page renders this directly, so a corrupt object must not
    // throw a 500 on the whole page.
    store.objects.set(PATH, { not: "an array" });
    expect(await recentActivity()).toEqual([]);
    expect(await activityFor("ecomech")).toEqual([]);
  });
});

describe("event classification", () => {
  it("treats a portal action against a client as a client event", () => {
    expect(isClientEvent(entry({ action: "accepted quotation", target: "ecomech" }))).toBe(true);
    expect(isClientEvent(entry({ action: "submitted questionnaire", target: "aurora" }))).toBe(true);
  });

  it("does not treat operator work as a client event", () => {
    expect(isClientEvent(entry({ action: "published quotation", target: "ecomech" }))).toBe(false);
  });

  it("excludes console-targeted entries even for a client action name", () => {
    // Sign-in noise logs against "console" and belongs to the Sessions card.
    expect(isClientEvent(entry({ action: "accepted quotation", target: "console" }))).toBe(false);
  });

  it("notifies on everything except the console target", () => {
    expect(isNotifiable(entry({ target: "ecomech", action: "sent invoice" }))).toBe(true);
    expect(isNotifiable(entry({ target: "console", action: "signed in" }))).toBe(false);
  });

  it("lists the client-initiated actions the admins are notified about", () => {
    expect(CLIENT_ACTIONS.has("signed the contract")).toBe(true);
    expect(CLIENT_ACTIONS.has("uploaded a file")).toBe(true);
    expect(CLIENT_ACTIONS.has("published quotation")).toBe(false);
  });

  it("builds a key that separates entries sharing a timestamp", () => {
    // Entries carry no id, so target and action have to be part of the key or
    // two things logged in the same millisecond would dismiss each other.
    const at = "2026-08-26T09:15:00.000Z";
    expect(entryKey({ at, target: "ecomech", action: "sent invoice" })).toBe(
      `${at}|ecomech|sent invoice`,
    );
    expect(entryKey({ at, target: "ecomech", action: "sent invoice" })).not.toBe(
      entryKey({ at, target: "ecomech", action: "sent receipt" }),
    );
  });
});

describe("notification marks", () => {
  it("reports never-seen as an empty string", async () => {
    expect(await getNotificationsSeenAt()).toBe("");
    expect(await getReadKeys()).toEqual(new Set());
  });

  it("stamps the seen time and clears the per-entry marks", async () => {
    // Everything at or before "now" is covered by the timestamp, so keeping the
    // per-entry list would only grow it forever.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-26T09:15:00.000Z"));

    await markEntryRead("2026-08-26T09:00:00.000Z|ecomech|sent invoice");
    await markNotificationsSeen();

    expect(await getNotificationsSeenAt()).toBe("2026-08-26T09:15:00.000Z");
    expect(await getReadKeys()).toEqual(new Set());
  });

  it("marks one entry read without disturbing the seen time", async () => {
    store.objects.set(NOTIF_PATH, { seenAt: "2026-08-20T00:00:00.000Z", read: [] });
    await markEntryRead("k1");

    expect(await getReadKeys()).toEqual(new Set(["k1"]));
    expect(await getNotificationsSeenAt()).toBe("2026-08-20T00:00:00.000Z");
  });

  it("does not record the same key twice", async () => {
    // Opening the same update twice is ordinary, and duplicates would eat the
    // 400-key budget.
    await markEntryRead("k1");
    await markEntryRead("k1");
    const state = store.objects.get(NOTIF_PATH) as { read?: string[] };
    expect(state.read).toEqual(["k1"]);
  });

  it("caps the read list at the newest 400 keys", async () => {
    const seed = Array.from({ length: 400 }, (_, i) => `key-${i}`);
    store.objects.set(NOTIF_PATH, { read: seed });
    await markEntryRead("key-new");

    const state = store.objects.get(NOTIF_PATH) as { read?: string[] };
    expect(state.read).toHaveLength(400);
    expect(atIndex(state.read ?? [], 0)).toBe("key-1");
    expect(atIndex(state.read ?? [], 399)).toBe("key-new");
  });

  it("degrades to unseen when the store read fails", async () => {
    store.state.failRead = true;
    expect(await getNotificationsSeenAt()).toBe("");
    expect(await getReadKeys()).toEqual(new Set());
  });

  it("swallows a failed read or seen write", async () => {
    store.state.failWrite = true;
    await expect(markEntryRead("k1")).resolves.toBeUndefined();
    await expect(markNotificationsSeen()).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalledTimes(2);
  });
});

describe("per-client seen marks", () => {
  it("reports an unopened client card as never seen", async () => {
    expect(await getClientSeenAt("ecomech")).toBe("");
  });

  it("stamps one client without clobbering another", async () => {
    // The marks share a single map object, so a write has to merge rather than
    // replace.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-26T09:15:00.000Z"));
    await markClientSeen("ecomech");

    vi.setSystemTime(new Date("2026-08-26T10:30:00.000Z"));
    await markClientSeen("aurora");

    expect(await getClientSeenAt("ecomech")).toBe("2026-08-26T09:15:00.000Z");
    expect(await getClientSeenAt("aurora")).toBe("2026-08-26T10:30:00.000Z");
    expect(store.objects.get(CLIENT_SEEN_PATH)).toEqual({
      ecomech: "2026-08-26T09:15:00.000Z",
      aurora: "2026-08-26T10:30:00.000Z",
    });
  });

  it("overwrites the mark when the card is opened again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-26T09:15:00.000Z"));
    await markClientSeen("ecomech");
    vi.setSystemTime(new Date("2026-08-27T09:15:00.000Z"));
    await markClientSeen("ecomech");

    expect(await getClientSeenAt("ecomech")).toBe("2026-08-27T09:15:00.000Z");
  });

  it("degrades to never-seen and swallows a write failure", async () => {
    store.state.failRead = true;
    expect(await getClientSeenAt("ecomech")).toBe("");

    store.state.failRead = false;
    store.state.failWrite = true;
    await expect(markClientSeen("ecomech")).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalled();
  });
});

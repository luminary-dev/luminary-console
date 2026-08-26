// The webhook inbox: a durable record of every delivery, its processing
// state, and its failures.
//
// The contract the webhook route must keep is "respond 200 within 2 seconds,
// no matter what, and never do work inline". So the receive path does exactly
// two things: persist the raw delivery, and return. Everything else happens
// on the processing pass.
//
// Storage note: deliveries are written to their OWN key, one object per
// delivery, never to a shared array. That is deliberate. A shared array would
// be a read-modify-write on every delivery, and webhooks arrive in bursts
// (one push fans out to check_run, check_suite, workflow_run, workflow_job,
// status), so a shared array would lose deliveries to the exact concurrency
// problem recorded as LC-002. One key per delivery has no such race, and the
// delivery id GitHub assigns makes the key naturally idempotent.
import { readState, writeState, clearState, listState } from "@/lib/store";

export type DeliveryState = "pending" | "processing" | "processed" | "failed" | "skipped";

export type StoredDelivery = {
  deliveryId: string;
  event: string;
  action?: string;
  /** The repository full name, when the payload names one. Lets the dead
   *  letter UI filter without parsing every payload again. */
  repo?: string;
  receivedAt: string;
  state: DeliveryState;
  attempts: number;
  processedAt?: string;
  /** Last failure, for the dead letter UI. */
  error?: string;
  /** Validation issues, when the payload did not match its schema. */
  issues?: string[];
  /** The raw payload exactly as received, so a replay is byte-faithful. */
  payload: unknown;
};

const INBOX_PREFIX = "github/deliveries";
const deliveryPath = (id: string) => `${INBOX_PREFIX}/${sanitizeId(id)}.json`;

/** Delivery ids are GitHub-issued UUIDs, but this value arrives in a header
 *  on a public endpoint, so it becomes part of a storage key only after it is
 *  proven to be an id and nothing else. */
export function sanitizeId(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) {
    throw new Error("Refusing to build a storage key from a malformed delivery id.");
  }
  return id;
}

export const isValidDeliveryId = (id: string): boolean => /^[A-Za-z0-9_-]{1,80}$/.test(id);

/**
 * Record a delivery. Returns whether this was new.
 *
 * Dedup is by delivery id: GitHub retries a delivery with the SAME id, so a
 * redelivery finds the existing record and is acknowledged without being
 * queued twice. This is a best-effort defence, not the correctness guarantee:
 * handlers are idempotent as well, because two instances can pass the
 * existence check simultaneously.
 */
export async function recordDelivery(input: {
  deliveryId: string;
  event: string;
  action?: string;
  repo?: string;
  payload: unknown;
}): Promise<{ stored: boolean; duplicate: boolean }> {
  const path = deliveryPath(input.deliveryId);
  const existing = await readState<StoredDelivery>(path).catch(() => null);
  if (existing) return { stored: false, duplicate: true };

  const record: StoredDelivery = {
    deliveryId: input.deliveryId,
    event: input.event,
    ...(input.action ? { action: input.action } : {}),
    ...(input.repo ? { repo: input.repo } : {}),
    receivedAt: new Date().toISOString(),
    state: "pending",
    attempts: 0,
    payload: input.payload,
  };
  await writeState(path, record);
  return { stored: true, duplicate: false };
}

export const getDelivery = (id: string): Promise<StoredDelivery | null> =>
  readState<StoredDelivery>(deliveryPath(id));

/** A patch key set to `undefined` means "clear this field", which is a
 *  different statement from omitting the key, so this is not a plain
 *  `Partial`: replaying a delivery has to be able to drop the old error. */
type ClearableField = "action" | "repo" | "processedAt" | "error" | "issues";

export type DeliveryPatch = Partial<
  Omit<StoredDelivery, "deliveryId" | "payload" | ClearableField>
> & {
  [K in ClearableField]?: StoredDelivery[K] | undefined;
};

export async function updateDelivery(
  id: string,
  patch: DeliveryPatch,
): Promise<StoredDelivery | null> {
  const current = await readState<StoredDelivery>(deliveryPath(id));
  if (!current) return null;
  // Cleared keys are dropped rather than kept as `undefined`, so the record
  // held in memory matches the one a later read gets back from JSON storage,
  // which never round-trips an undefined value.
  const { action, repo, processedAt, error, issues, ...rest } = { ...current, ...patch };
  const next: StoredDelivery = {
    ...rest,
    ...(action !== undefined ? { action } : {}),
    ...(repo !== undefined ? { repo } : {}),
    ...(processedAt !== undefined ? { processedAt } : {}),
    ...(error !== undefined ? { error } : {}),
    ...(issues !== undefined ? { issues } : {}),
  };
  await writeState(deliveryPath(id), next);
  return next;
}

/** Delivery keys, newest first is not possible from a key listing alone, so
 *  callers that need ordering read the records. Bounded by `max` because a
 *  busy org produces a lot of deliveries and this runs inside a request. */
export async function listDeliveryIds(max = 200): Promise<string[]> {
  const keys = await listState(`${INBOX_PREFIX}/`);
  return keys
    .map((k) => k.split("/").pop() ?? "")
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
    .slice(0, max);
}

export type DeliveryFilter = {
  state?: DeliveryState;
  event?: string;
  repo?: string;
  max?: number;
};

/** Read deliveries, newest first. */
export async function listDeliveries(filter: DeliveryFilter = {}): Promise<StoredDelivery[]> {
  const ids = await listDeliveryIds(1000);
  const records = await Promise.all(ids.map((id) => getDelivery(id).catch(() => null)));
  return records
    .filter((r): r is StoredDelivery => r !== null)
    .filter((r) => (filter.state ? r.state === filter.state : true))
    .filter((r) => (filter.event ? r.event === filter.event : true))
    .filter((r) => (filter.repo ? r.repo === filter.repo : true))
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
    .slice(0, filter.max ?? 100);
}

/** Deliveries waiting to be processed, oldest first so ordering is at least
 *  attempted even though handlers must not depend on it. */
export async function pendingDeliveries(max = 25): Promise<StoredDelivery[]> {
  const all = await listDeliveries({ max: 1000 });
  return all
    .filter((d) => d.state === "pending" || (d.state === "failed" && d.attempts < MAX_ATTEMPTS))
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
    .slice(0, max);
}

/** After this many attempts a delivery stops being retried automatically and
 *  waits for a human in the dead letter UI. */
export const MAX_ATTEMPTS = 5;

/** Delete a delivery record. Used by the retention sweep, not by processing:
 *  a processed delivery stays readable for a while because "show me the
 *  webhook history for this PR" is a debugging aid the mandate asks for. */
export const deleteDelivery = (id: string): Promise<void> => clearState(deliveryPath(id));

/** Deliveries older than the retention window, for the sweep. */
export async function expiredDeliveries(retentionDays = 30): Promise<StoredDelivery[]> {
  const cutoff = Date.now() - retentionDays * 86_400_000;
  const all = await listDeliveries({ max: 1000 });
  return all.filter(
    (d) =>
      (d.state === "processed" || d.state === "skipped") &&
      Date.parse(d.receivedAt) < cutoff,
  );
}

// ——— sync state ———
// Per-resource cursor and last-reconciled timestamp, so a backfill knows
// where it got to and reconciliation can report drift.

export type SyncState = {
  resource: string;
  lastReconciledAt?: string;
  lastCursor?: string;
  lastError?: string;
  /** How many entities the last reconciliation corrected. Non-zero means we
   *  missed webhooks, which is worth surfacing rather than silently fixing. */
  lastDrift?: number;
};

const syncPath = (resource: string) => `github/sync/${resource.replace(/[^a-z0-9_.-]/gi, "_")}.json`;

export const getSyncState = (resource: string): Promise<SyncState | null> =>
  readState<SyncState>(syncPath(resource));

export async function setSyncState(state: SyncState): Promise<void> {
  await writeState(syncPath(state.resource), state);
}

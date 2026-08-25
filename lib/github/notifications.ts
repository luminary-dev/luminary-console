// Notification rules for GitHub events.
//
// The mandate is specific about the shape: a rules engine rather than a
// global on-off, conditions over event type, repo, author, label and whether
// it involves you, producing a channel and an urgency, with sensible defaults
// so the rules engine is optional. Plus quiet hours with an override for
// genuine urgency, and aggressive grouping.
//
// The grouping requirement is the one that shapes the design: "ten pushes to
// one PR is one notification, updated in place, not ten". So a notification
// has a stable GROUP KEY derived from the thing it is about, and delivery
// collapses onto that key rather than appending.
import { readState, writeState, listState } from "@/lib/store";

export type Urgency = "urgent" | "normal" | "low";
export type Channel = "push" | "telegram" | "inapp" | "email";

export type NotificationRule = {
  id: string;
  label: string;
  enabled: boolean;
  /** All conditions must match. An absent condition matches everything. */
  when: {
    events?: string[];
    repos?: string[];
    authors?: string[];
    labels?: string[];
    /** Only fire when the event concerns the recipient (author, assignee,
     *  requested reviewer, or mentioned). */
    involvesMe?: boolean;
    /** Only fire when the check or run failed. */
    failedOnly?: boolean;
  };
  then: {
    channels: Channel[];
    urgency: Urgency;
  };
};

/** Shipped defaults, so the rules engine is optional. These encode what three
 *  engineers actually want to be interrupted for. */
export const DEFAULT_RULES: NotificationRule[] = [
  {
    id: "review-requested",
    label: "Someone asked me to review",
    enabled: true,
    when: { events: ["pull_request.review_requested"], involvesMe: true },
    then: { channels: ["push", "inapp"], urgency: "normal" },
  },
  {
    id: "my-pr-failed",
    label: "CI failed on my pull request",
    enabled: true,
    when: { events: ["check_run.completed", "workflow_run.completed"], involvesMe: true, failedOnly: true },
    then: { channels: ["push", "inapp"], urgency: "normal" },
  },
  {
    id: "my-pr-reviewed",
    label: "Someone reviewed my pull request",
    enabled: true,
    when: { events: ["pull_request_review.submitted"], involvesMe: true },
    then: { channels: ["push", "inapp"], urgency: "normal" },
  },
  {
    id: "production-deploy-failed",
    label: "A production deployment failed",
    enabled: true,
    // The one thing that overrides quiet hours: a failed production deploy is
    // the definition of genuine urgency for this team.
    when: { events: ["deployment_status.failure"] },
    then: { channels: ["push", "telegram", "inapp"], urgency: "urgent" },
  },
  {
    id: "secret-leaked",
    label: "A secret was detected in the organisation",
    enabled: true,
    when: { events: ["secret_scanning_alert.created"] },
    then: { channels: ["push", "telegram", "inapp"], urgency: "urgent" },
  },
  {
    id: "mentioned",
    label: "I was mentioned",
    enabled: true,
    when: { events: ["issue_comment.created", "pull_request_review_comment.created"], involvesMe: true },
    then: { channels: ["inapp"], urgency: "low" },
  },
];

export type NotificationEvent = {
  /** "<event>.<action>", the key rules match on. */
  key: string;
  repo?: string;
  author?: string;
  labels?: string[];
  /** Logins the event concerns. */
  involves?: string[];
  failed?: boolean;
  title: string;
  body?: string;
  url: string;
  /** Stable identity of the THING this is about, so ten pushes to one pull
   *  request collapse onto one notification instead of stacking. */
  groupKey: string;
};

export type Decision = {
  deliver: boolean;
  channels: Channel[];
  urgency: Urgency;
  /** Which rule decided, for the "why did I get this" question. */
  ruleId?: string;
  /** True when quiet hours held it back. */
  heldForQuietHours?: boolean;
};

export type Recipient = {
  login: string;
  quietHours?: { startHour: number; endHour: number; timeZone: string };
};

/** Does one rule match this event for this recipient? */
export function ruleMatches(
  rule: NotificationRule,
  event: NotificationEvent,
  recipient: Recipient,
): boolean {
  if (!rule.enabled) return false;
  const w = rule.when;

  if (w.events?.length) {
    // Match either the exact "event.action" or the bare event type, so a rule
    // can say "any pull_request event" without enumerating actions.
    // `split` always yields a first element; the fallback keeps a key with no
    // dot (a bare event type already) matching itself.
    const bare = event.key.split(".")[0] ?? event.key;
    if (!w.events.includes(event.key) && !w.events.includes(bare)) return false;
  }
  if (w.repos?.length && (!event.repo || !w.repos.includes(event.repo))) return false;
  if (w.authors?.length && (!event.author || !w.authors.includes(event.author))) return false;
  if (w.labels?.length) {
    const labels = event.labels ?? [];
    if (!w.labels.some((l) => labels.includes(l))) return false;
  }
  if (w.involvesMe && !(event.involves ?? []).includes(recipient.login)) return false;
  if (w.failedOnly && !event.failed) return false;
  return true;
}

/** Whether the recipient is inside their quiet hours right now. Handles a
 *  window that wraps midnight, which is the normal case for "22:00 to 08:00". */
export function inQuietHours(recipient: Recipient, now = new Date()): boolean {
  const quiet = recipient.quietHours;
  if (!quiet) return false;
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      hour12: false,
      timeZone: quiet.timeZone,
    }).format(now),
  );
  if (!Number.isFinite(hour)) return false;
  return quiet.startHour <= quiet.endHour
    ? hour >= quiet.startHour && hour < quiet.endHour
    : hour >= quiet.startHour || hour < quiet.endHour;
}

/**
 * Decide what to do with one event for one recipient.
 *
 * The first matching rule wins, and rules are evaluated in order, so the
 * urgent ones are listed first in DEFAULT_RULES. An urgent notification
 * overrides quiet hours; everything else is held back to the digest.
 */
export function decide(
  event: NotificationEvent,
  recipient: Recipient,
  rules: NotificationRule[] = DEFAULT_RULES,
  now = new Date(),
): Decision {
  const rule = rules.find((r) => ruleMatches(r, event, recipient));
  if (!rule) return { deliver: false, channels: [], urgency: "low" };

  if (rule.then.urgency !== "urgent" && inQuietHours(recipient, now)) {
    return {
      deliver: false,
      channels: [],
      urgency: rule.then.urgency,
      ruleId: rule.id,
      heldForQuietHours: true,
    };
  }

  return {
    deliver: true,
    channels: rule.then.channels,
    urgency: rule.then.urgency,
    ruleId: rule.id,
  };
}

// ——— stored notifications ———

export type StoredNotification = {
  id: string;
  groupKey: string;
  recipient: string;
  title: string;
  body?: string;
  url: string;
  urgency: Urgency;
  createdAt: string;
  updatedAt: string;
  /** How many events collapsed into this one notification. */
  count: number;
  readAt?: string;
};

const notifPath = (recipient: string, groupKey: string) =>
  `github/notifications/${safe(recipient)}/${safe(groupKey)}.json`;

const safe = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 120);

/**
 * Deliver into the in-app centre, collapsing onto the group key.
 *
 * This is the "ten pushes to one PR is one notification, updated in place"
 * requirement. An existing unread notification for the same group is updated
 * and its count incremented rather than a second one being created. A
 * notification already READ starts a fresh one, because a new event after you
 * have looked is genuinely new.
 */
export async function deliverInApp(
  event: NotificationEvent,
  recipient: string,
  urgency: Urgency,
): Promise<StoredNotification> {
  const path = notifPath(recipient, event.groupKey);
  const existing = await readState<StoredNotification>(path).catch(() => null);
  const now = new Date().toISOString();

  if (existing && !existing.readAt) {
    const updated: StoredNotification = {
      ...existing,
      title: event.title,
      ...(event.body ? { body: event.body } : {}),
      url: event.url,
      // Keep the highest urgency seen in the group: a failing check after ten
      // pushes must not be softened by the pushes.
      urgency: rank(urgency) > rank(existing.urgency) ? urgency : existing.urgency,
      updatedAt: now,
      count: existing.count + 1,
    };
    await writeState(path, updated);
    return updated;
  }

  const created: StoredNotification = {
    id: `${safe(event.groupKey)}-${Date.now()}`,
    groupKey: event.groupKey,
    recipient,
    title: event.title,
    ...(event.body ? { body: event.body } : {}),
    url: event.url,
    urgency,
    createdAt: now,
    updatedAt: now,
    count: 1,
  };
  await writeState(path, created);
  return created;
}

const rank = (u: Urgency): number => ({ low: 0, normal: 1, urgent: 2 })[u];

/** A recipient's notifications, newest first. */
export async function listNotifications(
  recipient: string,
  max = 100,
): Promise<StoredNotification[]> {
  const keys = await listState(`github/notifications/${safe(recipient)}/`);
  const records = await Promise.all(
    keys.slice(0, max).map(async (fullKey) => {
      const marker = "/state/";
      const at = fullKey.indexOf(marker);
      if (at === -1) return null;
      return readState<StoredNotification>(fullKey.slice(at + marker.length)).catch(() => null);
    }),
  );
  return records
    .filter((r): r is StoredNotification => r !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Mark one group read. Reading it in the console marks it read everywhere,
 *  which is the mandate's requirement, because the store is the single copy. */
export async function markRead(recipient: string, groupKey: string): Promise<void> {
  const path = notifPath(recipient, groupKey);
  const existing = await readState<StoredNotification>(path).catch(() => null);
  if (!existing || existing.readAt) return;
  await writeState(path, { ...existing, readAt: new Date().toISOString() });
}

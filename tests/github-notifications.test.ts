// Notification rules, quiet hours and grouping.
//
// The acceptance criterion the mandate states outright is the grouping one:
// "Ten pushes to one PR produce one grouped notification."
import { beforeEach, describe, expect, it, vi } from "vitest";

const objects = new Map<string, unknown>();

vi.mock("@/lib/store", () => ({
  readState: vi.fn(async (p: string) => (objects.has(p) ? structuredClone(objects.get(p)) : null)),
  writeState: vi.fn(async (p: string, d: unknown) => {
    objects.set(p, structuredClone(d));
  }),
  clearState: vi.fn(async (p: string) => {
    objects.delete(p);
  }),
  listState: vi.fn(async (prefix: string) =>
    [...objects.keys()].filter((k) => k.startsWith(prefix)).map((k) => `console/state/${k}`),
  ),
}));

import {
  DEFAULT_RULES,
  decide,
  deliverInApp,
  inQuietHours,
  listNotifications,
  markRead,
  ruleMatches,
  type NotificationEvent,
  type Recipient,
} from "@/lib/github/notifications";
import { atIndex } from "./helpers";

const me: Recipient = { login: "dhanika" };

function event(overrides: Partial<NotificationEvent> = {}): NotificationEvent {
  return {
    key: "pull_request.review_requested",
    repo: "luminary-dev/console",
    author: "gaveen",
    involves: ["dhanika"],
    title: "Review requested on console#7",
    url: "https://github.com/luminary-dev/console/pull/7",
    groupKey: "pr:luminary-dev/console#7",
    ...overrides,
  };
}

beforeEach(() => {
  objects.clear();
});

describe("rule matching", () => {
  it("fires when the event involves the recipient", () => {
    const decision = decide(event(), me);
    expect(decision.deliver).toBe(true);
    expect(decision.ruleId).toBe("review-requested");
    expect(decision.channels).toContain("push");
  });

  it("does not fire an involves-me rule for someone else's event", () => {
    const decision = decide(event({ involves: ["shashmitha"] }), me);
    expect(decision.deliver).toBe(false);
  });

  it("matches a bare event type as well as event.action", () => {
    const rule = {
      id: "any-pr",
      label: "Any pull request event",
      enabled: true,
      when: { events: ["pull_request"] },
      then: { channels: ["inapp" as const], urgency: "low" as const },
    };
    expect(ruleMatches(rule, event({ key: "pull_request.opened" }), me)).toBe(true);
    expect(ruleMatches(rule, event({ key: "issues.opened" }), me)).toBe(false);
  });

  it("respects a failedOnly condition", () => {
    const failing = event({ key: "check_run.completed", failed: true });
    const passing = event({ key: "check_run.completed", failed: false });
    expect(decide(failing, me).deliver).toBe(true);
    expect(decide(passing, me).deliver).toBe(false);
  });

  it("filters by repository and by label", () => {
    const rule = {
      id: "scoped",
      label: "Scoped",
      enabled: true,
      when: { repos: ["luminary-dev/console"], labels: ["urgent"] },
      then: { channels: ["inapp" as const], urgency: "normal" as const },
    };
    expect(ruleMatches(rule, event({ labels: ["urgent"] }), me)).toBe(true);
    expect(ruleMatches(rule, event({ labels: ["chore"] }), me)).toBe(false);
    expect(ruleMatches(rule, event({ repo: "luminary-dev/other", labels: ["urgent"] }), me)).toBe(false);
  });

  it("never fires a disabled rule", () => {
    const disabled = { ...atIndex(DEFAULT_RULES, 0), enabled: false };
    expect(ruleMatches(disabled, event(), me)).toBe(false);
  });

  it("delivers nothing when no rule matches, rather than defaulting to noisy", () => {
    const decision = decide(event({ key: "push", involves: [] }), me);
    expect(decision.deliver).toBe(false);
  });
});

describe("quiet hours", () => {
  const nightOwl: Recipient = {
    login: "dhanika",
    // The normal case: a window that wraps midnight.
    quietHours: { startHour: 22, endHour: 8, timeZone: "Asia/Colombo" },
  };

  it("recognises a window that wraps midnight", () => {
    // 02:00 Colombo is 20:30 UTC the previous day.
    const twoAmColombo = new Date("2026-08-26T20:30:00Z");
    expect(inQuietHours(nightOwl, twoAmColombo)).toBe(true);

    const middayColombo = new Date("2026-08-26T06:30:00Z");
    expect(inQuietHours(nightOwl, middayColombo)).toBe(false);
  });

  it("holds a normal notification back during quiet hours", () => {
    const twoAm = new Date("2026-08-26T20:30:00Z");
    const decision = decide(event(), nightOwl, DEFAULT_RULES, twoAm);
    expect(decision.deliver).toBe(false);
    expect(decision.heldForQuietHours).toBe(true);
  });

  it("lets a failed production deploy through quiet hours", () => {
    // This is the documented override: genuine urgency ignores quiet hours.
    const twoAm = new Date("2026-08-26T20:30:00Z");
    const decision = decide(
      event({ key: "deployment_status.failure", involves: [] }),
      nightOwl,
      DEFAULT_RULES,
      twoAm,
    );
    expect(decision.deliver).toBe(true);
    expect(decision.urgency).toBe("urgent");
  });

  it("lets a leaked secret through quiet hours", () => {
    const twoAm = new Date("2026-08-26T20:30:00Z");
    const decision = decide(
      event({ key: "secret_scanning_alert.created", involves: [] }),
      nightOwl,
      DEFAULT_RULES,
      twoAm,
    );
    expect(decision.deliver).toBe(true);
  });

  it("treats no configured quiet hours as never quiet", () => {
    expect(inQuietHours(me)).toBe(false);
  });
});

describe("grouping", () => {
  it("collapses ten pushes to one pull request into one notification", async () => {
    // The mandate's stated acceptance criterion.
    for (let i = 0; i < 10; i++) {
      await deliverInApp(
        event({ key: "pull_request.synchronize", title: `Push ${i + 1}` }),
        "dhanika",
        "normal",
      );
    }

    const notifications = await listNotifications("dhanika");
    expect(notifications).toHaveLength(1);
    expect(atIndex(notifications, 0).count).toBe(10);
    // The surviving copy shows the LATEST event, updated in place.
    expect(atIndex(notifications, 0).title).toBe("Push 10");
  });

  it("keeps the highest urgency seen in a group", async () => {
    await deliverInApp(event({ title: "A push" }), "dhanika", "low");
    await deliverInApp(event({ title: "CI failed" }), "dhanika", "urgent");
    await deliverInApp(event({ title: "Another push" }), "dhanika", "low");

    const notification = atIndex(await listNotifications("dhanika"), 0);
    // A failing check after ten pushes must not be softened by the pushes.
    expect(notification.urgency).toBe("urgent");
    expect(notification.count).toBe(3);
  });

  it("keeps different pull requests in different groups", async () => {
    await deliverInApp(event({ groupKey: "pr:repo#1" }), "dhanika", "normal");
    await deliverInApp(event({ groupKey: "pr:repo#2" }), "dhanika", "normal");
    expect(await listNotifications("dhanika")).toHaveLength(2);
  });

  it("starts a fresh notification once the group has been read", async () => {
    // A new event after you have looked is genuinely new, not a continuation.
    await deliverInApp(event(), "dhanika", "normal");
    await markRead("dhanika", "pr:luminary-dev/console#7");
    await deliverInApp(event({ title: "Something new" }), "dhanika", "normal");

    const notification = atIndex(await listNotifications("dhanika"), 0);
    expect(notification.count).toBe(1);
    expect(notification.title).toBe("Something new");
    expect(notification.readAt).toBeUndefined();
  });

  it("keeps recipients separate", async () => {
    await deliverInApp(event(), "dhanika", "normal");
    await deliverInApp(event(), "gaveen", "normal");
    expect(await listNotifications("dhanika")).toHaveLength(1);
    expect(await listNotifications("gaveen")).toHaveLength(1);
  });

  it("marking read is idempotent", async () => {
    await deliverInApp(event(), "dhanika", "normal");
    await markRead("dhanika", "pr:luminary-dev/console#7");
    const first = atIndex(await listNotifications("dhanika"), 0).readAt;
    await markRead("dhanika", "pr:luminary-dev/console#7");
    expect(atIndex(await listNotifications("dhanika"), 0).readAt).toBe(first);
  });
});

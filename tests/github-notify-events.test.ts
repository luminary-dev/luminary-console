// Mapping a webhook payload onto a notification: who hears about what, and
// what gets grouped together.
import { beforeEach, describe, expect, it } from "vitest";
import { mentionsIn, toNotificationEvent } from "@/lib/github/notify-events";

beforeEach(() => {
  process.env.GITHUB_OPERATORS =
    "dhanikaanupama2000@gmail.com:dhanikaa,buddhikagaveen2021@gmail.com:gaveen";
});

const repository = { id: 1, name: "console", full_name: "luminary-dev/console" };

describe("pull request events", () => {
  it("tells the requested reviewer, taking them from requested_reviewer", () => {
    // On a review_requested event the person being asked is in
    // `requested_reviewer`; the PR's own list may not include them yet.
    const notification = toNotificationEvent("pull_request", {
      action: "review_requested",
      repository,
      requested_reviewer: { login: "gaveen" },
      pull_request: { number: 7, title: "Add a thing", user: { login: "dhanikaa" } },
    });
    expect(notification?.involves).toContain("gaveen");
    expect(notification?.key).toBe("pull_request.review_requested");
    expect(notification?.groupKey).toBe("pr:luminary-dev/console#7");
  });

  it("uses plain wording rather than the raw action name", () => {
    const notification = toNotificationEvent("pull_request", {
      action: "ready_for_review",
      repository,
      pull_request: { number: 7, title: "Add a thing" },
    });
    expect(notification?.title).toContain("Ready for review");
    expect(notification?.title).toContain("console#7");
  });

  it("tells the pull request author when their work is reviewed", () => {
    const notification = toNotificationEvent("pull_request_review", {
      action: "submitted",
      repository,
      review: { state: "changes_requested", user: { login: "gaveen" } },
      pull_request: { number: 7, title: "Add a thing", user: { login: "dhanikaa" } },
    });
    expect(notification?.involves).toEqual(["dhanikaa"]);
    expect(notification?.title).toContain("changes requested");
  });
});

describe("check and run failures", () => {
  it("notifies only on a real failure", () => {
    const base = { action: "completed", repository };
    const failed = toNotificationEvent("check_run", {
      ...base,
      check_run: { name: "unit", conclusion: "failure", pull_requests: [{ number: 7 }] },
    });
    expect(failed).not.toBeNull();
    expect(failed?.failed).toBe(true);

    for (const conclusion of ["success", "neutral", "skipped", null]) {
      // neutral and skipped are not failures, and a success is not news.
      const quiet = toNotificationEvent("check_run", {
        ...base,
        check_run: { name: "unit", conclusion, pull_requests: [{ number: 7 }] },
      });
      expect(quiet).toBeNull();
    }
  });

  it("groups a failing check onto its pull request, not onto the check", () => {
    // So ten failing checks on one PR collapse into one notification.
    const notification = toNotificationEvent("workflow_run", {
      action: "completed",
      repository,
      workflow_run: { name: "CI", conclusion: "failure", pull_requests: [{ number: 7 }] },
    });
    expect(notification?.groupKey).toBe("pr:luminary-dev/console#7");
  });

  it("falls back to a run-scoped group when there is no pull request", () => {
    const notification = toNotificationEvent("workflow_run", {
      action: "completed",
      repository,
      workflow_run: { name: "nightly", conclusion: "failure" },
    });
    expect(notification?.groupKey).toBe("run:luminary-dev/console:nightly");
  });
});

describe("deployments and secrets", () => {
  it("tells everyone when a deployment fails", () => {
    const notification = toNotificationEvent("deployment_status", {
      repository,
      deployment: { environment: "production" },
      deployment_status: { state: "failure", environment: "production" },
    });
    expect(notification?.key).toBe("deployment_status.failure");
    expect(notification?.involves).toEqual(expect.arrayContaining(["dhanikaa", "gaveen"]));
  });

  it("maps an error state onto failure so one rule covers both", () => {
    const notification = toNotificationEvent("deployment_status", {
      repository,
      deployment: { environment: "production" },
      deployment_status: { state: "error" },
    });
    expect(notification?.key).toBe("deployment_status.failure");
  });

  it("says nothing about a successful deployment", () => {
    const notification = toNotificationEvent("deployment_status", {
      repository,
      deployment: { environment: "production" },
      deployment_status: { state: "success" },
    });
    expect(notification).toBeNull();
  });

  it("tells everyone about a detected secret", () => {
    const notification = toNotificationEvent("secret_scanning_alert", {
      action: "created",
      repository,
      alert: { number: 3, secret_type_display_name: "AWS access key" },
    });
    expect(notification?.involves).toEqual(expect.arrayContaining(["dhanikaa", "gaveen"]));
    expect(notification?.body).toBe("AWS access key");
  });
});

describe("mentions", () => {
  it("finds a mention at the start and mid-sentence", () => {
    expect(mentionsIn("@gaveen can you look?")).toEqual(["gaveen"]);
    expect(mentionsIn("thanks @Dhanikaa for this")).toEqual(["dhanikaa"]);
  });

  it("does not treat an email address as a mention", () => {
    // The classic false positive: every comment quoting an address would
    // notify a nonexistent user.
    expect(mentionsIn("write to support@luminary-dev.xyz")).toEqual([]);
  });

  it("does not treat a path fragment as a mention", () => {
    expect(mentionsIn("see node_modules/@scope/pkg")).toEqual([]);
  });

  it("notifies a mentioned user on a comment", () => {
    const notification = toNotificationEvent("issue_comment", {
      action: "created",
      repository,
      issue: { number: 7, title: "A thing", user: { login: "dhanikaa" } },
      comment: { body: "@gaveen thoughts?", user: { login: "dhanikaa" } },
    });
    expect(notification?.involves).toEqual(expect.arrayContaining(["gaveen"]));
  });

  it("says nothing for a comment that mentions nobody and has no author to tell", () => {
    const notification = toNotificationEvent("issue_comment", {
      action: "created",
      repository,
      issue: { number: 7, title: "A thing" },
      comment: { body: "looks good", user: { login: "dhanikaa" } },
    });
    expect(notification).toBeNull();
  });
});

describe("events nobody needs to hear about", () => {
  it("returns null for an unmapped event type", () => {
    expect(toNotificationEvent("push", { repository, ref: "refs/heads/main" })).toBeNull();
  });

  it("returns null when the payload has no repository", () => {
    expect(
      toNotificationEvent("pull_request", {
        action: "opened",
        pull_request: { number: 1, title: "x" },
      }),
    ).toBeNull();
  });
});

// Merge readiness, view filtering and CI grouping.
//
// These are the derived facts the PR inbox shows, so a wrong answer here is a
// console that lies about whether something can merge, which the severity
// rubric puts at High.
import { describe, expect, it } from "vitest";
import {
  ageInDays,
  isFailingConclusion,
  isStale,
  mergeReadiness,
  toPullRequestEntity,
  type PullRequestEntity,
} from "@/lib/github/entities";
import { atIndex } from "./helpers";
import { applyView, groupFailures, viewCounts } from "@/lib/github/views";

function pr(overrides: Partial<PullRequestEntity> = {}): PullRequestEntity {
  return {
    id: 1,
    repo: "luminary-dev/console",
    number: 7,
    title: "Add a thing",
    state: "open",
    draft: false,
    author: { id: 10, login: "dhanika" },
    assignees: [],
    requestedReviewers: [],
    labels: [],
    headRef: "feat/thing",
    headSha: "abc1234",
    baseRef: "main",
    fromFork: false,
    createdAt: new Date(Date.now() - 86_400_000).toISOString(),
    updatedAt: new Date().toISOString(),
    mergeable: true,
    url: "https://github.com/luminary-dev/console/pull/7",
    reviews: [],
    checks: [],
    syncedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("check conclusions", () => {
  it("does not treat neutral or skipped as a failure", () => {
    // Rendering these as red makes a healthy PR look broken, which is the
    // single most common check-status misread.
    expect(isFailingConclusion("neutral")).toBe(false);
    expect(isFailingConclusion("skipped")).toBe(false);
    expect(isFailingConclusion("success")).toBe(false);
    expect(isFailingConclusion(null)).toBe(false);
  });

  it("treats real failures as failures", () => {
    expect(isFailingConclusion("failure")).toBe(true);
    expect(isFailingConclusion("timed_out")).toBe(true);
    expect(isFailingConclusion("action_required")).toBe(true);
  });
});

describe("merge readiness", () => {
  it("reports ready when nothing blocks", () => {
    const verdict = mergeReadiness(pr({ checks: [check("build", "success")] }));
    expect(verdict.ready).toBe(true);
    expect(verdict.summary).toBe("Ready to merge");
  });

  it("names the specific failing check rather than saying checks failed", () => {
    const verdict = mergeReadiness(pr({ checks: [check("unit tests", "failure")] }));
    expect(verdict.ready).toBe(false);
    expect(verdict.summary).toBe("Check failing: unit tests");
  });

  it("counts multiple failures instead of naming one", () => {
    const verdict = mergeReadiness(
      pr({ checks: [check("a", "failure"), check("b", "failure")] }),
    );
    expect(verdict.summary).toBe("2 checks failing");
  });

  it("does not claim conflicts while GitHub is still computing mergeability", () => {
    // mergeable === null means "not computed yet". Reporting a conflict then
    // is a lie that resolves itself a second later.
    const verdict = mergeReadiness(pr({ mergeable: null }));
    expect(verdict.blockers).not.toContain("conflicts");
  });

  it("reports conflicts when GitHub says the branch conflicts", () => {
    const verdict = mergeReadiness(pr({ mergeable: false }));
    expect(verdict.blockers).toContain("conflicts");
    expect(verdict.summary).toBe("Conflicts with the base branch");
  });

  it("leads with draft even when checks are also failing", () => {
    // Being a draft is the thing the author would fix first.
    const verdict = mergeReadiness(
      pr({ draft: true, checks: [check("build", "failure")] }),
    );
    expect(verdict.summary).toBe("Draft, not ready for review");
    expect(verdict.blockers).toContain("failing_checks");
  });

  it("blocks on requested changes", () => {
    const verdict = mergeReadiness(
      pr({ reviews: [review("CHANGES_REQUESTED")], checks: [check("build", "success")] }),
    );
    expect(verdict.summary).toBe("Changes requested");
  });

  it("ignores a dismissed changes-requested review", () => {
    // A dismissed review no longer gates the merge, though it stays in the
    // timeline.
    const verdict = mergeReadiness(
      pr({
        reviews: [{ ...review("CHANGES_REQUESTED"), dismissed: true }],
        checks: [check("build", "success")],
      }),
    );
    expect(verdict.ready).toBe(true);
  });

  it("waits on review only when a reviewer was actually requested", () => {
    const requested = mergeReadiness(
      pr({ requestedReviewers: [{ id: 2, login: "gaveen" }] }),
    );
    expect(requested.summary).toBe("Waiting on review");

    // Nobody was asked, so nothing is waiting on a review.
    const notRequested = mergeReadiness(pr());
    expect(notRequested.ready).toBe(true);
  });

  it("blocks on unresolved conversations and counts them", () => {
    const verdict = mergeReadiness(pr({ unresolvedThreads: 3 }));
    expect(verdict.summary).toBe("3 unresolved conversations");
  });

  it("reports being behind the base branch with the branch name", () => {
    const verdict = mergeReadiness(pr({ behindBy: 4 }));
    expect(verdict.summary).toBe("Behind main by 4 commits");
  });

  it("reports a merged pull request as merged, not as blocked", () => {
    const verdict = mergeReadiness(pr({ state: "merged" }));
    expect(verdict.summary).toBe("Merged");
  });

  it("waits on pending checks rather than calling them ready", () => {
    const verdict = mergeReadiness(pr({ checks: [check("deploy", null, "in_progress")] }));
    expect(verdict.summary).toBe("Waiting on deploy");
  });
});

describe("fork detection", () => {
  it("treats a pull request from another repository as a fork", () => {
    const entity = toPullRequestEntity("luminary-dev/console", {
      id: 1,
      number: 2,
      state: "open",
      title: "From a fork",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      head: { ref: "patch", sha: "aaa", repo: { id: 9, name: "console", full_name: "outsider/console" } },
      base: { ref: "main", sha: "bbb", repo: { id: 1, name: "console", full_name: "luminary-dev/console" } },
    });
    expect(entity.fromFork).toBe(true);
  });

  it("treats a deleted head repository as a fork rather than as our own", () => {
    // A deleted fork leaves head.repo null. Calling that "not a fork" would
    // wrongly promise that secrets were available to its checks.
    const entity = toPullRequestEntity("luminary-dev/console", {
      id: 1,
      number: 2,
      state: "closed",
      title: "Fork since deleted",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      head: { ref: "patch", sha: "aaa", repo: null },
      base: { ref: "main", sha: "bbb", repo: { id: 1, name: "console", full_name: "luminary-dev/console" } },
    });
    expect(entity.fromFork).toBe(true);
  });

  it("marks a merged pull request as merged even when state says closed", () => {
    const entity = toPullRequestEntity("luminary-dev/console", {
      id: 1,
      number: 2,
      state: "closed",
      merged_at: "2026-01-02T00:00:00Z",
      title: "Merged",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
      head: { ref: "a", sha: "aaa" },
      base: { ref: "main", sha: "bbb" },
    });
    expect(entity.state).toBe("merged");
  });
});

describe("staleness", () => {
  it("counts a pull request untouched for three days as stale", () => {
    const old = new Date(Date.now() - 4 * 86_400_000).toISOString();
    expect(isStale(pr({ updatedAt: old }))).toBe(true);
  });

  it("never counts a draft as stale, because a draft is parked on purpose", () => {
    const old = new Date(Date.now() - 30 * 86_400_000).toISOString();
    expect(isStale(pr({ updatedAt: old, draft: true }))).toBe(false);
  });

  it("returns zero rather than NaN for an unparsable date", () => {
    expect(ageInDays("not a date")).toBe(0);
  });
});

describe("saved views", () => {
  const viewer = { viewerLogin: "gaveen" };

  it("puts a requested review in Needs my review", () => {
    const list = [pr({ requestedReviewers: [{ id: 2, login: "gaveen" }] })];
    expect(applyView(list, "needs-my-review", viewer)).toHaveLength(1);
  });

  it("drops it once that reviewer has reviewed", () => {
    // GitHub keeps the request listed after a review; the ball is no longer
    // in the reviewer's court and the view must reflect that.
    const list = [
      pr({
        requestedReviewers: [{ id: 2, login: "gaveen" }],
        reviews: [{ ...review("APPROVED"), author: { id: 2, login: "gaveen" } }],
      }),
    ];
    expect(applyView(list, "needs-my-review", viewer)).toHaveLength(0);
  });

  it("returns nothing for a personal view when the viewer is unknown", () => {
    const list = [pr({ requestedReviewers: [{ id: 2, login: "gaveen" }] })];
    expect(applyView(list, "needs-my-review", {})).toHaveLength(0);
  });

  it("falls back to everything for an unknown view id, never to an empty list", () => {
    // An empty list reads as "nothing is happening", which is the one thing a
    // console must not say wrongly.
    const list = [pr()];
    expect(applyView(list, "no-such-view")).toHaveLength(1);
  });

  it("counts every view in one pass", () => {
    const list = [
      pr({ draft: true }),
      pr({ number: 8, checks: [check("build", "failure")] }),
      pr({ number: 9, checks: [check("build", "success")] }),
    ];
    const counts = viewCounts(list, viewer);
    expect(counts.drafts).toBe(1);
    expect(counts["failing-ci"]).toBe(1);
    expect(counts.everything).toBe(3);
  });
});

describe("grouped CI failures", () => {
  it("groups the same failing check across pull requests, most widespread first", () => {
    const list = [
      pr({ number: 1, checks: [check("flaky test", "failure")] }),
      pr({ number: 2, checks: [check("flaky test", "failure")] }),
      pr({ number: 3, checks: [check("flaky test", "failure"), check("lint", "failure")] }),
    ];
    const groups = groupFailures(list);
    expect(groups[0]).toMatchObject({ name: "flaky test", count: 3 });
    expect(groups[1]).toMatchObject({ name: "lint", count: 1 });
  });

  it("counts a pull request once even when the same check fails twice on it", () => {
    // A matrix build reports one run per leg and a re-run adds another, so
    // the same check name can fail more than once on one pull request.
    // Counting those separately would claim the check is blocking more pull
    // requests than it is, and would render duplicate rows.
    const list = [
      pr({ number: 1, checks: [check("build", "failure"), check("build", "failure")] }),
      pr({ number: 2, checks: [check("build", "failure")] }),
    ];
    const group = atIndex(groupFailures(list), 0);
    expect(group.count).toBe(2);
    expect(group.prs).toHaveLength(2);
    expect(new Set(group.prs.map((p) => `${p.repo}#${p.number}`)).size).toBe(2);
  });

  it("ignores neutral and skipped checks when grouping", () => {
    const list = [pr({ checks: [check("optional", "skipped"), check("advisory", "neutral")] })];
    expect(groupFailures(list)).toHaveLength(0);
  });
});

// ——— helpers ———

function check(
  name: string,
  conclusion: string | null,
  status = "completed",
): PullRequestEntity["checks"][number] {
  return {
    id: Math.floor(Math.random() * 1e6),
    name,
    status,
    conclusion: conclusion as PullRequestEntity["checks"][number]["conclusion"],
  };
}

function review(state: string): PullRequestEntity["reviews"][number] {
  return {
    id: 1,
    state: state as PullRequestEntity["reviews"][number]["state"],
    dismissed: false,
    author: { id: 3, login: "reviewer" },
    submittedAt: new Date().toISOString(),
  };
}

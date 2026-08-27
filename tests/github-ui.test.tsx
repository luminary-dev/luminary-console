// @vitest-environment jsdom
// The pull request workspace UI.
//
// Four things are load-bearing enough to gate a merge on: the verdict names
// the SPECIFIC blocker rather than saying "blocked", the keyboard map works
// (this is an engineering tool and j/k/Enter is how it is driven), an empty
// inbox explains itself instead of reading as "nothing is happening", and no
// status is carried by colour alone.
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import CheckList, { ChecksSummary } from "@/components/github/CheckList";
import MergeVerdict from "@/components/github/MergeVerdict";
import PrInbox from "@/components/github/PrInbox";
import ReviewList, { ReviewsSummary } from "@/components/github/ReviewList";
import FailureGroups from "@/components/github/FailureGroups";
import type { PullRequestEntity } from "@/lib/github/entities";
import { viewCounts } from "@/lib/github/views";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, prefetch: vi.fn() }) }));

afterEach(() => {
  cleanup();
  push.mockReset();
  try {
    window.localStorage.clear();
  } catch {
    // Storage is optional in this environment.
  }
});

// === fixtures ===

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
    headSha: "abc1234def567",
    baseRef: "main",
    fromFork: false,
    createdAt: "2026-08-20T09:00:00.000Z",
    updatedAt: "2026-08-25T09:00:00.000Z",
    mergeable: true,
    url: "https://github.com/luminary-dev/console/pull/7",
    reviews: [],
    checks: [],
    syncedAt: "2026-08-26T09:00:00.000Z",
    ...overrides,
  };
}

function check(
  name: string,
  conclusion: string | null,
  status = "completed",
): PullRequestEntity["checks"][number] {
  return {
    id: name.length * 31 + (conclusion?.length ?? 0),
    name,
    status,
    conclusion: conclusion as PullRequestEntity["checks"][number]["conclusion"],
  };
}

function review(state: string, login = "gaveen"): PullRequestEntity["reviews"][number] {
  return {
    id: login.length,
    state: state as PullRequestEntity["reviews"][number]["state"],
    dismissed: false,
    author: { id: 2, login },
    submittedAt: "2026-08-24T09:00:00.000Z",
  };
}

const NOW = Date.parse("2026-08-26T12:00:00.000Z");

const inbox = (prs: PullRequestEntity[], configured = true) => (
  <PrInbox
    prs={prs}
    counts={viewCounts(prs, { now: NOW })}
    now={NOW}
    githubConfigured={configured}
  />
);

// === the verdict names the blocker ===

describe("merge verdict", () => {
  it("names the failing check rather than saying checks failed", () => {
    render(<MergeVerdict pr={pr({ checks: [check("unit tests", "failure")] })} />);
    expect(screen.getByText("Check failing: unit tests")).toBeTruthy();
  });

  it("names the branch it conflicts with", () => {
    render(<MergeVerdict pr={pr({ mergeable: false, baseRef: "release" })} />);
    expect(screen.getByText("Conflicts with the base branch")).toBeTruthy();
  });

  it("lists EVERY blocker on the detail view, not only the first", () => {
    // A draft that also conflicts and has a failing check: the row would say
    // "draft", and clearing that alone would leave two surprises behind.
    const entity = pr({
      draft: true,
      mergeable: false,
      behindBy: 3,
      unresolvedThreads: 2,
      checks: [check("lint", "failure"), check("deploy", null, "in_progress")],
    });
    const { container } = render(<MergeVerdict pr={entity} detailed />);

    const items = within(container).getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(items).toHaveLength(6);
    expect(items.some((t) => t.includes("Still a draft"))).toBe(true);
    expect(items.some((t) => t.includes("Conflicts with main"))).toBe(true);
    // Specific, with the check named and the next action in the sentence.
    expect(items.some((t) => t.includes("failing: lint"))).toBe(true);
    expect(items.some((t) => t.includes("still running: deploy"))).toBe(true);
    expect(items.some((t) => t.includes("2 review conversations are still unresolved"))).toBe(true);
    expect(items.some((t) => t.includes("Behind main by 3 commits"))).toBe(true);
  });

  it("says plainly when nothing is blocking", () => {
    const { container } = render(<MergeVerdict pr={pr({ checks: [check("build", "success")] })} detailed />);
    expect(screen.getByText("Ready to merge")).toBeTruthy();
    expect(within(container).queryAllByRole("listitem")).toHaveLength(0);
  });
});

// === keyboard navigation ===

describe("keyboard navigation", () => {
  const rows = [
    pr({ number: 1, title: "First", updatedAt: "2026-08-25T12:00:00.000Z" }),
    pr({ number: 2, title: "Second", updatedAt: "2026-08-25T11:00:00.000Z" }),
    pr({ number: 3, title: "Third", updatedAt: "2026-08-25T10:00:00.000Z" }),
  ];

  const selectedRow = () => document.querySelector("tr.gh-row.is-selected");

  it("j and k move the selection, and selection is real focus", async () => {
    const user = userEvent.setup();
    render(inbox(rows));

    await user.keyboard("j");
    expect(selectedRow()?.textContent).toContain("First");
    // Focus follows, so a screen reader lands on the same row the eye does.
    expect(document.activeElement?.textContent).toContain("First");
    expect(selectedRow()?.getAttribute("aria-current")).toBe("true");

    await user.keyboard("j");
    expect(selectedRow()?.textContent).toContain("Second");
    expect(document.activeElement?.textContent).toContain("Second");

    await user.keyboard("k");
    expect(selectedRow()?.textContent).toContain("First");

    // The top is a floor, not a wrap: k at the top must not jump to the end.
    await user.keyboard("k");
    expect(selectedRow()?.textContent).toContain("First");
  });

  it("Enter opens the selected pull request", async () => {
    const user = userEvent.setup();
    render(inbox(rows));

    await user.keyboard("jj");
    await user.keyboard("{Enter}");
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/github/luminary-dev/console/2");
  });

  it("Escape clears the selection and drops focus", async () => {
    const user = userEvent.setup();
    render(inbox(rows));

    await user.keyboard("j");
    expect(selectedRow()).not.toBeNull();

    await user.keyboard("{Escape}");
    expect(selectedRow()).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it("does not hijack j and k while typing in a field", async () => {
    const user = userEvent.setup();
    render(inbox(rows));

    const login = screen.getByLabelText("Your GitHub login");
    await user.click(login);
    await user.keyboard("jk");

    expect(login).toHaveProperty("value", "jk");
    expect(selectedRow()).toBeNull();
  });

  it("keeps one tab stop in the list, so Tab does not walk every row", () => {
    render(inbox(rows));
    const links = screen.getAllByRole("link", { name: /console #/ });
    expect(links.map((l) => l.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
  });
});

// === empty state ===

describe("empty inbox", () => {
  it("explains that a backfill may be needed when GitHub is configured", () => {
    render(inbox([], true));
    expect(screen.getByRole("heading", { name: "No pull requests stored yet" })).toBeTruthy();
    expect(screen.getByText(/no backfill has run/i)).toBeTruthy();
  });

  it("says GitHub is not configured yet when no credential exists", () => {
    render(inbox([], false));
    expect(screen.getByText(/No GitHub credential is configured/i)).toBeTruthy();
    // Names the first action rather than leaving the operator guessing.
    expect(screen.getByText("GITHUB_APP_ID")).toBeTruthy();
  });

  it("offers a way back when a view filters everything out", async () => {
    const user = userEvent.setup();
    render(inbox([pr({ draft: true })]));

    await user.click(screen.getByRole("button", { name: /Failing CI/i }));
    expect(screen.getByText(/No pull requests match this view/i)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "every open pull request" }));
    expect(screen.getByRole("link", { name: /console #7/ })).toBeTruthy();
  });
});

// === status is never colour alone ===

describe("status is never colour alone", () => {
  const noBareIcons = (container: HTMLElement) => {
    const icons = [...container.querySelectorAll("svg")];
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) {
      // Decorative, and always paired with words in the same status element.
      expect(icon.getAttribute("aria-hidden")).toBe("true");
      const words = icon.parentElement?.textContent?.trim() ?? "";
      expect(words.length).toBeGreaterThan(0);
    }
  };

  it("spells out every check state in words", () => {
    const { container } = render(
      <CheckList
        checks={[
          check("unit tests", "failure"),
          check("build", "success"),
          check("deploy", null, "in_progress"),
          check("optional", "skipped"),
        ]}
      />,
    );
    expect(screen.getByText("failure")).toBeTruthy();
    expect(screen.getByText("passed")).toBeTruthy();
    expect(screen.getByText("running")).toBeTruthy();
    expect(screen.getByText("skipped")).toBeTruthy();
    noBareIcons(container);
  });

  it("spells out every review state in words", () => {
    const { container } = render(
      <ReviewList
        reviews={[review("APPROVED", "gaveen"), review("CHANGES_REQUESTED", "shash")]}
        requested={[{ id: 4, login: "waiting-one" }]}
      />,
    );
    expect(screen.getByText("approved")).toBeTruthy();
    expect(screen.getByText("requested changes")).toBeTruthy();
    expect(screen.getByText("review requested")).toBeTruthy();
    noBareIcons(container);
  });

  it("gives the row summaries words too", () => {
    const { container } = render(
      <>
        <ChecksSummary checks={[check("unit tests", "failure"), check("build", "success")]} />
        <ReviewsSummary reviews={[review("APPROVED")]} requested={[]} />
      </>,
    );
    expect(screen.getByText("1 failing, 1 passed")).toBeTruthy();
    expect(screen.getByText("1 approved")).toBeTruthy();
    noBareIcons(container);
  });

  it("labels grouped CI failures with a count in words", () => {
    const { container } = render(
      <FailureGroups
        groups={[
          {
            name: "flaky test",
            count: 2,
            prs: [
              { repo: "luminary-dev/console", number: 1, title: "First" },
              { repo: "luminary-dev/console", number: 2, title: "Second" },
            ],
          },
        ]}
      />,
    );
    expect(screen.getByText("failing on 2 pull requests")).toBeTruthy();
    noBareIcons(container);
  });

  it("carries the verdict as text in every inbox row", () => {
    render(inbox([pr({ checks: [check("unit tests", "failure")] })]));
    expect(screen.getByText("Check failing: unit tests")).toBeTruthy();
  });
});

// === saved views ===

describe("saved views", () => {
  it("counts each view on its chip and marks the active one pressed", async () => {
    const user = userEvent.setup();
    render(
      inbox([
        pr({ number: 1, draft: true }),
        pr({ number: 2, checks: [check("build", "failure")] }),
        pr({ number: 3, checks: [check("build", "success")] }),
      ]),
    );

    const drafts = screen.getByRole("button", { name: /^Drafts/ });
    expect(drafts.textContent).toContain("1");
    expect(drafts.getAttribute("aria-pressed")).toBe("false");

    await user.click(drafts);
    expect(drafts.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByRole("link", { name: /console #/ })).toHaveLength(1);
  });

  it("disables the personal views until a GitHub login is known", () => {
    render(inbox([pr()]));
    const mine = screen.getByRole("button", { name: /Needs my review/ });
    expect(mine).toHaveProperty("disabled", true);
    expect(mine.getAttribute("title")).toBe("Add your GitHub login to use this view");
  });

  it("sorting exposes aria-sort on the column it sorted", async () => {
    const user = userEvent.setup();
    render(inbox([pr({ number: 1 }), pr({ number: 2 })]));

    const header = screen.getByRole("columnheader", { name: /Pull request/ });
    expect(header.getAttribute("aria-sort")).toBe("none");
    await user.click(within(header).getByRole("button"));
    expect(header.getAttribute("aria-sort")).toBe("ascending");
  });
});

describe("LC-088 the personal views know who you are", () => {
  afterEach(cleanup);

  it("seeds the login from the operator, so the personal views are not silently empty", () => {
    // Both personal views counted zero for everyone until the reader typed
    // their own GitHub login into a text box, and a confident
    // "Needs my review · 0" is worse than an empty state: it reads as
    // "nothing is waiting on you". The server knows the operator, and
    // GITHUB_OPERATORS maps them to a login, so it is passed in.
    const prs = [pr({ number: 1 })];
    render(
      <PrInbox
        prs={prs}
        counts={viewCounts(prs, { now: NOW })}
        now={NOW}
        githubConfigured
        operatorLogin="dhanikaa"
      />,
    );
    expect((screen.getByLabelText(/your github login/i) as HTMLInputElement).value).toBe("dhanikaa");
  });

  it("renders an empty login when the operator is not mapped", () => {
    // No GITHUB_OPERATORS entry means no guess: an invented login would
    // filter the views to someone else's work.
    const prs = [pr({ number: 1 })];
    render(
      <PrInbox
        prs={prs}
        counts={viewCounts(prs, { now: NOW })}
        now={NOW}
        githubConfigured
      />,
    );
    expect((screen.getByLabelText(/your github login/i) as HTMLInputElement).value).toBe("");
  });
});

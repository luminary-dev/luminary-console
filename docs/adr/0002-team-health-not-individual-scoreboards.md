# 2. Insights measure team health, never individual productivity

Date: 2026-08-26

## Status

Accepted.

## Context

The console now ingests every pull request, review, check and deployment in
the `luminary-dev` organisation. That data would support a per-person
leaderboard: PRs merged per engineer, review turnaround by reviewer, lines
written per week. Building one is a small amount of extra code on top of what
already exists, and dashboards of exactly that shape are common in
engineering tools.

The mandate for this console rules it out explicitly: present insights "as
team health signals, framed for improving the process. Explicitly do not build
individual productivity scoreboards; with three people that is corrosive and
useless."

Two things make that judgement correct here rather than merely cautious.

First, the metrics are trivially gameable and the gaming is harmful. If PRs
merged per person is on a dashboard, the rational move is to split work into
more, smaller PRs regardless of whether that helps the code, and to avoid the
hard, slow, valuable work that produces one PR a fortnight. If review
turnaround is scored, the rational move is to approve faster and read less.

Second, at three people the numbers carry no statistical weight at all. One
person taking a week off, or spending a sprint on a gnarly migration, moves
every per-person number enough to swamp any real signal. A ranking of three
people where the ordering is noise is worse than no ranking, because it looks
like information.

## Decision

`lib/github/insights.ts` aggregates across the team only. Specifically:

- No function takes a person as a parameter or returns a per-person series.
- Throughput is counted for the organisation, and reported as merged, opened,
  and **net**, because a positive merge count while the backlog grows is the
  thing worth knowing and the raw count hides it.
- Cycle time is reported as median and p90 over all pull requests, not per
  author. Time to first review is included because a long value there is
  usually the reason a cycle is slow, and it is a queue problem the team owns.
- Review load is a **queue length** ("how many PRs are waiting, and how long
  has the oldest waited") rather than a per-reviewer backlog.
- The flake leaderboard ranks CHECKS. A check that both passes and fails on
  the same head SHA is flaky by definition, because the code did not change
  between the two runs. This is the one leaderboard in the product and its
  subjects are machines.
- Size distribution is bucketed across all PRs, to support the "smaller pull
  requests get reviewed faster" conversation, without naming who wrote the
  large ones.

Percentiles use nearest-rank with no interpolation, because the samples are
small and interpolation would invent precision the data does not have. Medians
and p90s are used in preference to means throughout, since one outlier drags a
mean around and this team's outliers are normal (one long migration PR).

## Consequences

- "Who is the most productive" is not answerable from this console, by
  construction. That is intended. If it is ever asked, the answer is that the
  tool does not know and should not.
- Some genuinely useful per-person facts are also unavailable, for example
  "how many reviews am I personally sitting on". This is mitigated where it
  matters by the personal views ("Needs my review", "My pull requests"), which
  are a WORKLIST for the person looking, not a measurement of them, and which
  are never aggregated, stored as a metric, or shown to anyone else.
- Adding a per-person metric later means revisiting this ADR, which is the
  point of writing it down: the omission is a decision with reasons, not a gap
  someone should helpfully fill in.

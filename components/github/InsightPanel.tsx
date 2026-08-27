// Team health signals.
//
// This component is bound by docs/adr/0002-team-health-not-individual-
// scoreboards.md. Nothing here is keyed by a person, nothing ranks people, and
// the one leaderboard in the product ranks CHECKS. With three engineers a
// per-person number is noise dressed up as information, and the moment it is
// on a dashboard the rational response is to game it.
//
// The second rule this file enforces: a metric with no sample renders "not
// enough data", never 0. Zero is a real answer ("nothing merged this week")
// and printing it for an absent one is a lie the reader cannot detect.
import {
  formatDuration,
  formatHours,
  type DurationTrend,
  type FlakeStat,
  type Insights,
} from "@/lib/github/insights";
import { StatusIcon, type StatusTone } from "./MergeVerdict";

/** The one place a null becomes words. Every caller goes through it so no
 *  screen can quietly print 0 for "we do not know". */
export const NO_DATA = "not enough data";

export function metricValue(value: number | null, format: (n: number) => string): string {
  return value === null || !Number.isFinite(value) ? NO_DATA : format(value);
}

function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  const absent = value === NO_DATA;
  return (
    // The note lives INSIDE the <dd>, not beside it. A <dl> may contain only
    // dt/dd groups, and axe recurses into a <div> child and applies the same
    // rule there, so a sibling <p> failed `definition-list` on all four
    // panels. Nesting it keeps the markup valid and renders identically:
    // .gh-metric-v is a block and .gh-metric-note only sets colour, size,
    // line-height and a 4px top margin.
    <div>
      <dt className="gh-metric-k">{label}</dt>
      <dd className={`gh-metric-v${absent ? " is-absent" : ""}`}>
        {value}
        {note ? <p className="gh-metric-note">{note}</p> : null}
      </dd>
    </div>
  );
}

/**
 * Flaky or broken, said out loud.
 *
 * These need different actions and the row says which. A check that both
 * passed and failed on the SAME commit is flaky: the code did not change
 * between the two runs, so the check did, and re-running it only hides that.
 * A check that fails every time is broken: it is reporting a real fault and
 * re-running it wastes everyone's minutes.
 */
export function flakeDiagnosis(stat: FlakeStat): {
  label: string;
  tone: StatusTone;
  action: string;
} {
  if (stat.flaky) {
    return {
      label: "Flaky",
      tone: "warn",
      action:
        "Passed and failed on the same commit, so the check is the variable, not the code. Quarantine or fix the test. Re-running only hides it.",
    };
  }
  return {
    label: "Broken",
    tone: "bad",
    action:
      "Fails consistently, so treat it as a real failure and fix the cause. Re-running will not turn it green.",
  };
}

/** The only leaderboard in this console, and its subjects are machines. */
export function FlakeLeaderboard({ flakes }: { flakes: FlakeStat[] }) {
  if (flakes.length === 0) {
    return (
      <p className="gh-note">
        No check has failed in the stored run history. When one does, it appears here ranked by how
        often it fails, with a diagnosis of whether it is flaky or genuinely broken.
      </p>
    );
  }

  return (
    <>
      <p className="gh-note">
        Ranked by failure rate. The diagnosis column separates the two cases, because they need
        opposite responses: a flaky check is a test problem, a broken check is a code problem.
      </p>
      <div className="gh-scroll">
        <table className="gh-table gh-table--tight">
          <caption className="sr-only">
            Failing checks ranked by failure rate, with a flaky or broken diagnosis and the action
            each one needs.
          </caption>
          <thead>
            <tr>
              <th scope="col">Check</th>
              <th scope="col">Diagnosis</th>
              <th scope="col" className="gh-num">
                Failure rate
              </th>
              <th scope="col" className="gh-num">
                Failures
              </th>
              <th scope="col" className="gh-num">
                Runs
              </th>
            </tr>
          </thead>
          <tbody>
            {flakes.map((stat) => {
              const diagnosis = flakeDiagnosis(stat);
              const percent = Math.round(stat.failureRate * 100);
              return (
                <tr className="gh-row" key={stat.name}>
                  <th scope="row">
                    <span className="gh-line-name">{stat.name}</span>
                  </th>
                  <td>
                    <span className={`gh-status is-${diagnosis.tone}`}>
                      <StatusIcon tone={diagnosis.tone} />
                      <span>
                        <span className="gh-status-strong">{diagnosis.label}</span>
                        <span className="gh-sub-text">{diagnosis.action}</span>
                      </span>
                    </span>
                  </td>
                  <td className="gh-num">
                    {percent}%
                    {/* The bar is a second reading of the number in the same
                        cell, so it is decorative and the table is the
                        accessible form. */}
                    <span className="gh-bar" aria-hidden="true">
                      <span
                        className={`gh-bar-fill ${stat.flaky ? "is-warn" : "is-bad"}`}
                        style={{ width: `${Math.max(2, percent)}%` }}
                      />
                    </span>
                  </td>
                  <td className="gh-num">{stat.failures}</td>
                  <td className="gh-num">{stat.runs}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Workflow durations, slowest median first, with the bar drawn against the
 *  slowest workflow in the set. */
export function DurationTable({ durations }: { durations: DurationTrend[] }) {
  if (durations.length === 0) {
    return (
      <p className="gh-note">
        No run in the stored history reported a duration, so there is {NO_DATA} to trend yet. Run
        a backfill to pull recent workflow runs in.
      </p>
    );
  }

  const slowest = durations.reduce((max, d) => Math.max(max, d.medianMs ?? 0), 0);

  return (
    <>
      <p className="gh-note">
        Median and 90th percentile per workflow, slowest median first. Medians rather than means:
        one long run drags a mean around and this team&apos;s long runs are normal.
      </p>
      <div className="gh-scroll">
        <table className="gh-table gh-table--tight">
          <caption className="sr-only">
            Workflow run durations, with median, 90th percentile and the number of runs measured.
          </caption>
          <thead>
            <tr>
              <th scope="col">Workflow</th>
              <th scope="col" className="gh-num">
                Median
              </th>
              <th scope="col" className="gh-num">
                90th percentile
              </th>
              <th scope="col" className="gh-num">
                Runs measured
              </th>
            </tr>
          </thead>
          <tbody>
            {durations.map((trend) => (
              <tr className="gh-row" key={trend.name}>
                <th scope="row">
                  <span className="gh-line-name">{trend.name}</span>
                </th>
                <td className="gh-num">
                  {formatDuration(trend.medianMs)}
                  <span className="gh-bar" aria-hidden="true">
                    <span
                      className="gh-bar-fill"
                      style={{
                        width: slowest > 0 ? `${Math.max(2, ((trend.medianMs ?? 0) / slowest) * 100)}%` : "2%",
                      }}
                    />
                  </span>
                </td>
                <td className="gh-num">{formatDuration(trend.p90Ms)}</td>
                <td className="gh-num">{trend.runs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function InsightPanel({ insights }: { insights: Insights }) {
  const { throughput, cycleTime, size, reviewLoad } = insights;
  const backlogGrowing = throughput.net < 0;
  const biggestBucket = size.buckets.reduce((max, b) => Math.max(max, b.count), 0);

  return (
    <>
      <section className="card" aria-labelledby="ins-throughput">
        <h2 className="gh-card-title" id="ins-throughput">
          Throughput, last {throughput.windowDays} days
        </h2>
        <p className="gh-note">
          Counted for the whole organisation. Net is merged minus opened: a healthy merge count
          while the backlog grows is the thing worth knowing, and the raw counts alone hide it.
        </p>
        <dl className="gh-metrics">
          <Metric label="Merged" value={String(throughput.merged)} />
          <Metric label="Opened" value={String(throughput.opened)} />
          <Metric
            label="Net"
            value={`${throughput.net > 0 ? "+" : ""}${throughput.net}`}
            note={
              backlogGrowing
                ? "More opened than merged, so the review backlog is growing."
                : "Merging at least as fast as pull requests arrive."
            }
          />
        </dl>
        <p className={`gh-status is-${backlogGrowing ? "warn" : "ok"}`} style={{ marginTop: 12 }}>
          <StatusIcon tone={backlogGrowing ? "warn" : "ok"} />
          <span>
            {backlogGrowing
              ? "Backlog growing: more pull requests opened than merged in this window."
              : "Backlog steady or shrinking in this window."}
          </span>
        </p>
      </section>

      <section className="card" aria-labelledby="ins-cycle">
        <h2 className="gh-card-title" id="ins-cycle">
          Cycle time
        </h2>
        <p className="gh-note">
          Across every pull request, never per author. A long time to first review is the usual
          cause of a slow cycle, and it is a queue the team owns rather than a fault of whoever
          opened the pull request.
        </p>
        <dl className="gh-metrics">
          <Metric
            label="Open to merge, median"
            value={formatHours(cycleTime.openToMergeHours.median)}
            note={`${cycleTime.openToMergeHours.count} merged pull requests measured.`}
          />
          <Metric
            label="Open to merge, p90"
            value={formatHours(cycleTime.openToMergeHours.p90)}
          />
          <Metric
            label="Open to first review, median"
            value={formatHours(cycleTime.openToFirstReviewHours.median)}
            note={`${cycleTime.openToFirstReviewHours.count} reviewed pull requests measured.`}
          />
          <Metric
            label="Open to first review, p90"
            value={formatHours(cycleTime.openToFirstReviewHours.p90)}
          />
        </dl>
      </section>

      <section className="card" aria-labelledby="ins-review-load">
        <h2 className="gh-card-title" id="ins-review-load">
          Review queue
        </h2>
        <p className="gh-note">
          A queue length, not a per-reviewer backlog. The question this answers is whether work is
          piling up waiting for attention, not who is sitting on it.
        </p>
        <dl className="gh-metrics">
          <Metric
            label="Waiting on review"
            value={String(reviewLoad.awaitingReview)}
            note="Open, not a draft, reviewers requested, nobody has approved yet."
          />
          <Metric
            label="Oldest wait"
            value={formatHours(reviewLoad.oldestWaitHours)}
            note="Time since the oldest waiting pull request was last touched."
          />
        </dl>
      </section>

      <section className="card" aria-labelledby="ins-size">
        <h2 className="gh-card-title" id="ins-size">
          Pull request size
        </h2>
        <p className="gh-note">
          Bucketed across every pull request, without naming who wrote the large ones. Smaller
          pull requests get reviewed faster, so this supports that conversation and no other.
        </p>
        <dl className="gh-metrics">
          <Metric
            label="Median lines changed"
            value={metricValue(size.medianLinesChanged, (n) => `${Math.round(n)} lines`)}
            note="Pull requests whose line counts were never synced are left out rather than counted as zero."
          />
        </dl>
        <div className="gh-scroll">
          <table className="gh-table gh-table--tight" style={{ minWidth: 420 }}>
            <caption className="sr-only">
              Pull requests grouped by lines changed, with a count in each bucket.
            </caption>
            <thead>
              <tr>
                <th scope="col">Size</th>
                <th scope="col" className="gh-num">
                  Pull requests
                </th>
              </tr>
            </thead>
            <tbody>
              {size.buckets.map((bucket) => (
                <tr className="gh-row" key={bucket.label}>
                  <th scope="row">{bucket.label}</th>
                  <td className="gh-num">
                    {bucket.count}
                    <span className="gh-bar" aria-hidden="true">
                      <span
                        className="gh-bar-fill"
                        style={{
                          width:
                            biggestBucket > 0
                              ? `${Math.max(bucket.count === 0 ? 0 : 2, (bucket.count / biggestBucket) * 100)}%`
                              : "0%",
                        }}
                      />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" aria-labelledby="ins-flakes">
        <h2 className="gh-card-title" id="ins-flakes">
          Flake leaderboard
        </h2>
        <FlakeLeaderboard flakes={insights.flakes} />
      </section>

      <section className="card" aria-labelledby="ins-durations">
        <h2 className="gh-card-title" id="ins-durations">
          Workflow durations
        </h2>
        <DurationTable durations={insights.durations} />
      </section>

      <section className="card" aria-labelledby="ins-scope">
        <h2 className="gh-card-title" id="ins-scope">
          What this screen deliberately does not measure
        </h2>
        <p className="gh-note">
          There is no per-person metric here and there will not be one. With three engineers, one
          holiday or one gnarly migration swamps any per-person number, so a ranking of three
          people is noise that looks like information, and once it is on a dashboard the rational
          move is to split work into more, smaller pull requests and to review less carefully.
          The reasoning is written down in <b>docs/adr/0002-team-health-not-individual-scoreboards.md</b>,
          so adding one later means revisiting that decision rather than filling a gap.
        </p>
        <p className="gh-note">
          The personal saved views on the pull request inbox are a worklist for whoever is looking,
          not a measurement of them: they are never aggregated, stored as a metric, or shown to
          anyone else.
        </p>
        <p className="gh-note">
          Computed {insights.generatedAt.slice(0, 16).replace("T", " ")} UTC from the stored
          projection.
        </p>
      </section>
    </>
  );
}

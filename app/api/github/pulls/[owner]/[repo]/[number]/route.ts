// Pull request actions, behind the console session gate.
//
// Every mutating action is audited to the same activity log the rest of the
// console writes to, attributed to the signed-in operator, because the
// mandate's access model requires that every mutating action be auditable and
// because "who merged that" is a question worth being able to answer.
import { NextResponse } from "next/server";
import {
  closePullRequest,
  commentOnPullRequest,
  mergePullRequest,
  reopenPullRequest,
  requestReview,
  rerunFailedJobs,
  setDraft,
  setLabels,
  submitReview,
  updateBranch,
  type MergeMethod,
} from "@/lib/github/actions";
import { fetchPullRequest, fetchPullRequestFiles, fetchJobFailureExcerpt } from "@/lib/github/api";
import { getPullRequest, putPullRequest } from "@/lib/github/projection";
import { githubConfigured } from "@/lib/github/config";
import { logOperatorActivity } from "@/lib/operator";
import { GitHubError, GitHubUnavailableError } from "@/lib/github/client";

export const runtime = "nodejs";
export const maxDuration = 120;

type Params = { params: Promise<{ owner: string; repo: string; number: string }> };

/** Path segments come from the URL, so they are validated before they are
 *  concatenated into an API path. */
function resolve(owner: string, repo: string, number: string) {
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(repo)) {
    return null;
  }
  const n = Number(number);
  if (!Number.isInteger(n) || n <= 0) return null;
  return { full: `${owner}/${repo}`, number: n };
}

export async function GET(req: Request, { params }: Params) {
  const { owner, repo, number } = await params;
  const target = resolve(owner, repo, number);
  if (!target) return NextResponse.json({ error: "Bad pull request reference." }, { status: 400 });

  const url = new URL(req.url);
  const want = url.searchParams.get("include");

  try {
    // Serve the projection by default; `?refresh=1` forces a read-through so
    // an operator can always get the truth without waiting for a webhook.
    const stored = url.searchParams.get("refresh") === "1"
      ? null
      : await getPullRequest(target.full, target.number);

    const pr = stored ?? (await fetchPullRequest(target.full, target.number));
    if (!pr) return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (!stored) await putPullRequest(pr);

    if (want === "files") {
      const files = await fetchPullRequestFiles(target.full, target.number);
      return NextResponse.json({ pullRequest: pr, files });
    }

    return NextResponse.json({ pullRequest: pr });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request, { params }: Params) {
  if (!githubConfigured()) {
    return NextResponse.json(
      { error: "GitHub is not configured on this deployment." },
      { status: 503 },
    );
  }

  const { owner, repo, number } = await params;
  const target = resolve(owner, repo, number);
  if (!target) return NextResponse.json({ error: "Bad pull request reference." }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "");
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;

  try {
    switch (action) {
      case "approve":
      case "request-changes":
      case "comment-review": {
        const event =
          action === "approve"
            ? "APPROVE"
            : action === "request-changes"
              ? "REQUEST_CHANGES"
              : "COMMENT";
        const result = await submitReview(target.full, target.number, event, str(body.body));
        if (result.ok) await audit(result.summary, target.full, target.number);
        return NextResponse.json(result, { status: result.ok ? 200 : 400 });
      }

      case "comment": {
        const text = str(body.body);
        if (!text) return NextResponse.json({ error: "The comment is empty." }, { status: 400 });
        const result = await commentOnPullRequest(target.full, target.number, text);
        if (result.ok) await audit(result.summary, target.full, target.number);
        return NextResponse.json(result);
      }

      case "request-review": {
        const reviewers = Array.isArray(body.reviewers)
          ? body.reviewers.filter((r): r is string => typeof r === "string")
          : [];
        const result = await requestReview(target.full, target.number, reviewers);
        if (result.ok) await audit(result.summary, target.full, target.number);
        return NextResponse.json(result, { status: result.ok ? 200 : 400 });
      }

      case "set-labels": {
        const labels = Array.isArray(body.labels)
          ? body.labels.filter((l): l is string => typeof l === "string")
          : [];
        const result = await setLabels(target.full, target.number, labels);
        if (result.ok) await audit(result.summary, target.full, target.number);
        return NextResponse.json(result);
      }

      case "set-draft": {
        const result = await setDraft(target.full, target.number, body.draft === true);
        if (result.ok) await audit(result.summary, target.full, target.number);
        return NextResponse.json(result, { status: result.ok ? 200 : 400 });
      }

      case "update-branch": {
        const result = await updateBranch(target.full, target.number);
        if (result.ok) await audit(result.summary, target.full, target.number);
        return NextResponse.json(result);
      }

      case "rerun-failed": {
        const runId = Number(body.runId);
        if (!Number.isInteger(runId) || runId <= 0) {
          return NextResponse.json({ error: "A workflow run id is required." }, { status: 400 });
        }
        const result = await rerunFailedJobs(target.full, runId);
        if (result.ok) await audit(result.summary, target.full, target.number);
        return NextResponse.json(result);
      }

      case "merge": {
        // The head SHA the operator was looking at is mandatory: without it a
        // push landing between page load and click would ship unreviewed code.
        const expectedHeadSha = str(body.expectedHeadSha);
        if (!expectedHeadSha) {
          return NextResponse.json(
            { error: "Reload the pull request: the merge needs the head commit you reviewed." },
            { status: 400 },
          );
        }
        const method = ["merge", "squash", "rebase"].includes(String(body.method))
          ? (String(body.method) as MergeMethod)
          : "squash";
        const result = await mergePullRequest(target.full, target.number, {
          method,
          expectedHeadSha,
          ...(str(body.title) ? { title: str(body.title) as string } : {}),
          ...(str(body.message) ? { message: str(body.message) as string } : {}),
        });
        // A merge is audited whether or not it succeeded, because a refused
        // merge is itself worth a line in the log.
        await audit(result.summary, target.full, target.number);
        return NextResponse.json(result, { status: result.ok ? 200 : 409 });
      }

      case "close": {
        const result = await closePullRequest(target.full, target.number);
        if (result.ok) await audit(result.summary, target.full, target.number);
        return NextResponse.json(result);
      }

      case "reopen": {
        const result = await reopenPullRequest(target.full, target.number);
        if (result.ok) await audit(result.summary, target.full, target.number);
        return NextResponse.json(result);
      }

      case "job-log": {
        const jobId = Number(body.jobId);
        if (!Number.isInteger(jobId) || jobId <= 0) {
          return NextResponse.json({ error: "A job id is required." }, { status: 400 });
        }
        const excerpt = await fetchJobFailureExcerpt(target.full, jobId);
        return NextResponse.json({
          excerpt,
          ...(excerpt ? {} : { note: "The log has expired or is not available." }),
        });
      }

      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (e) {
    return errorResponse(e);
  }
}

async function audit(summary: string, repo: string, number: number): Promise<void> {
  await logOperatorActivity(summary, "github", `${repo}#${number}`);
}

/** Map a GitHub failure onto a response the UI can render. The `error` field
 *  is what every form in this console reads, so it is always present. */
function errorResponse(e: unknown): NextResponse {
  if (e instanceof GitHubUnavailableError) {
    return NextResponse.json(
      {
        error: "GitHub is not responding right now. The console will retry shortly.",
        retryAfterMs: e.retryAfterMs,
      },
      { status: 503 },
    );
  }
  if (e instanceof GitHubError) {
    // 403 from GitHub on a write almost always means the App lacks the
    // permission, which is a configuration problem with a specific fix.
    const detail =
      e.status === 403
        ? `GitHub refused this action: ${e.message}. Check the App's permissions in docs/GITHUB-APP.md.`
        : e.message;
    return NextResponse.json({ error: detail }, { status: e.status === 404 ? 404 : 502 });
  }
  console.error("[github] pull request action failed:", e);
  return NextResponse.json({ error: "That did not work." }, { status: 500 });
}

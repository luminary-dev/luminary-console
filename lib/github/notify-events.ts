// Turning a processed delivery into notifications.
//
// Kept separate from the handlers on purpose: a handler's job is to make the
// projection correct, and it must not fail because a notification could not
// be sent. So this runs after a handler succeeds, and every failure inside it
// is swallowed with a log, the same contract the rest of the console's
// notification code follows.
import { knownGithubLogins } from "./config";
import {
  DEFAULT_RULES,
  decide,
  deliverInApp,
  type NotificationEvent,
  type Recipient,
} from "./notifications";
import { sendPushNotice } from "@/lib/push";
import { sendTelegram, tgEsc } from "@/lib/telegram";

const CONSOLE_HOST =
  process.env.CONSOLE_HOST || `console.${process.env.ROOT_DOMAIN || "luminary-dev.xyz"}`;

/** Build the notification event for one delivery, or null when the event is
 *  not something anyone should be told about. */
export function toNotificationEvent(event: string, payload: unknown): NotificationEvent | null {
  const body = payload as Record<string, unknown>;
  const repo = (body.repository as { full_name?: string } | undefined)?.full_name;
  const action = typeof body.action === "string" ? body.action : "";
  const key = action ? `${event}.${action}` : event;

  switch (event) {
    case "pull_request": {
      const pr = body.pull_request as
        | {
            number: number;
            title: string;
            user?: { login?: string };
            requested_reviewers?: { login?: string }[];
            assignees?: { login?: string }[];
            labels?: { name?: string }[];
            html_url?: string;
          }
        | undefined;
      if (!pr || !repo) return null;
      const requested = body.requested_reviewer as { login?: string } | undefined;
      return {
        key,
        repo,
        ...(pr.user?.login ? { author: pr.user.login } : {}),
        labels: (pr.labels ?? []).map((l) => l.name ?? "").filter(Boolean),
        involves: logins([
          // On a review_requested event the person being asked is in
          // `requested_reviewer`, not in the PR's list yet.
          requested?.login,
          ...(pr.requested_reviewers ?? []).map((r) => r.login),
          ...(pr.assignees ?? []).map((a) => a.login),
        ]),
        title: `${titleFor(event, action)} on ${shortRepo(repo)}#${pr.number}`,
        body: pr.title,
        url: pr.html_url ?? ghUrl(repo, pr.number),
        groupKey: `pr:${repo}#${pr.number}`,
      };
    }

    case "pull_request_review": {
      const pr = body.pull_request as
        | { number: number; title: string; user?: { login?: string }; html_url?: string }
        | undefined;
      const review = body.review as { state?: string; user?: { login?: string } } | undefined;
      if (!pr || !repo) return null;
      return {
        key,
        repo,
        ...(review?.user?.login ? { author: review.user.login } : {}),
        // The person told is the PR's author: their work was reviewed.
        involves: logins([pr.user?.login]),
        title: `${(review?.state ?? "reviewed").toLowerCase().replace(/_/g, " ")} on ${shortRepo(repo)}#${pr.number}`,
        body: pr.title,
        url: pr.html_url ?? ghUrl(repo, pr.number),
        groupKey: `pr:${repo}#${pr.number}`,
      };
    }

    case "check_run":
    case "workflow_run": {
      const run =
        (body.check_run as Record<string, unknown> | undefined) ??
        (body.workflow_run as Record<string, unknown> | undefined);
      if (!run || !repo) return null;
      const conclusion = typeof run.conclusion === "string" ? run.conclusion : null;
      // Only a real failure is worth an interruption. neutral and skipped are
      // not failures, and a success is not news.
      const failed = ["failure", "timed_out", "startup_failure"].includes(conclusion ?? "");
      if (!failed) return null;
      const prs = (run.pull_requests as { number: number }[] | undefined) ?? [];
      const number = prs[0]?.number;
      const name = typeof run.name === "string" ? run.name : "A check";
      return {
        key,
        repo,
        failed: true,
        involves: logins([(run.actor as { login?: string } | undefined)?.login]),
        title: `${name} failed on ${shortRepo(repo)}${number ? `#${number}` : ""}`,
        url:
          typeof run.html_url === "string"
            ? run.html_url
            : number
              ? ghUrl(repo, number)
              : `https://github.com/${repo}`,
        // Group on the pull request where we know it, so ten failing checks
        // on one PR are one notification rather than ten.
        groupKey: number ? `pr:${repo}#${number}` : `run:${repo}:${name}`,
      };
    }

    case "deployment_status": {
      const status = body.deployment_status as
        | { state?: string; environment?: string; description?: string }
        | undefined;
      const deployment = body.deployment as { environment?: string } | undefined;
      if (!status || !repo) return null;
      // Only failures and successes into production are worth telling anyone.
      const environment = status.environment ?? deployment?.environment ?? "an environment";
      const failed = status.state === "failure" || status.state === "error";
      if (!failed) return null;
      return {
        key: `deployment_status.${status.state === "error" ? "failure" : status.state}`,
        repo,
        failed: true,
        involves: knownGithubLogins(),
        title: `Deployment to ${environment} failed on ${shortRepo(repo)}`,
        ...(status.description ? { body: status.description } : {}),
        url: `https://github.com/${repo}/deployments`,
        groupKey: `deploy:${repo}:${environment}`,
      };
    }

    case "secret_scanning_alert": {
      const alert = body.alert as
        | { number?: number; secret_type_display_name?: string; html_url?: string }
        | undefined;
      if (!alert || !repo || action !== "created") return null;
      return {
        key,
        repo,
        // Everyone hears about a leaked credential.
        involves: knownGithubLogins(),
        title: `Secret detected in ${shortRepo(repo)}`,
        ...(alert.secret_type_display_name ? { body: alert.secret_type_display_name } : {}),
        url: alert.html_url ?? `https://github.com/${repo}/security/secret-scanning`,
        groupKey: `secret:${repo}#${alert.number ?? 0}`,
      };
    }

    case "issue_comment":
    case "pull_request_review_comment": {
      const comment = body.comment as
        | { body?: string; user?: { login?: string }; html_url?: string }
        | undefined;
      const issue = (body.issue ?? body.pull_request) as
        | { number?: number; title?: string; user?: { login?: string } }
        | undefined;
      if (!comment || !repo || action !== "created") return null;
      // Mentions are what make a comment worth a notification.
      const mentioned = mentionsIn(comment.body ?? "");
      const involves = logins([...mentioned, issue?.user?.login]);
      if (!involves.length) return null;
      return {
        key,
        repo,
        ...(comment.user?.login ? { author: comment.user.login } : {}),
        involves,
        title: `Comment on ${shortRepo(repo)}#${issue?.number ?? ""}`,
        ...(comment.body ? { body: comment.body.slice(0, 200) } : {}),
        url: comment.html_url ?? ghUrl(repo, issue?.number ?? 0),
        groupKey: `pr:${repo}#${issue?.number ?? 0}`,
      };
    }

    default:
      return null;
  }
}

/**
 * Decide and deliver for every mapped operator.
 *
 * Never throws: a notification failure must not fail the delivery that
 * triggered it, exactly as the rest of this console's notification code
 * behaves.
 */
export async function notifyForDelivery(event: string, payload: unknown): Promise<number> {
  try {
    const notification = toNotificationEvent(event, payload);
    if (!notification) return 0;

    const recipients = knownGithubLogins();
    if (!recipients.length) return 0;

    let delivered = 0;
    for (const login of recipients) {
      const recipient: Recipient = { login, ...quietHoursFor(login) };
      const decision = decide(notification, recipient, DEFAULT_RULES);
      if (!decision.deliver) continue;

      // The in-app centre is always written when a rule fires, because that
      // is the record; the push and Telegram legs are the interruption.
      if (decision.channels.includes("inapp")) {
        await deliverInApp(notification, login, decision.urgency).catch((e) =>
          console.error("[github] in-app notification failed:", e),
        );
      }
      if (decision.channels.includes("push")) {
        await sendPushNotice({
          title: notification.title,
          company: shortRepo(notification.repo ?? ""),
          lines: [notification.body ?? ""],
          url: notification.url,
        }).catch(() => 0);
      }
      if (decision.channels.includes("telegram")) {
        await sendTelegram(
          [
            `<b>${tgEsc(notification.title)}</b>`,
            notification.body ? tgEsc(notification.body) : "",
            `<a href="${notification.url}">Open on GitHub</a>`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        ).catch(() => false);
      }
      delivered += 1;
    }
    return delivered;
  } catch (e) {
    console.error("[github] notification dispatch failed:", e);
    return 0;
  }
}

/** Per-operator quiet hours. Env-configured for now, the same shape the
 *  notification settings UI will write when it lands. */
function quietHoursFor(login: string): Pick<Recipient, "quietHours"> {
  const raw = process.env.GITHUB_QUIET_HOURS; // "login:22-8,login:23-7"
  if (!raw) return {};
  for (const entry of raw.split(",")) {
    const [who, window] = entry.split(":").map((s) => s.trim());
    if (who?.toLowerCase() !== login.toLowerCase() || !window) continue;
    const [start, end] = window.split("-").map(Number);
    // A window missing its second half ("22" rather than "22-8") leaves `end`
    // absent, which is as malformed as a non-integer.
    if (start === undefined || end === undefined) continue;
    if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
    return {
      quietHours: {
        startHour: start,
        endHour: end,
        timeZone: process.env.GITHUB_QUIET_TZ || "Asia/Colombo",
      },
    };
  }
  return {};
}

const logins = (values: (string | undefined)[]): string[] => [
  ...new Set(values.filter((v): v is string => !!v).map((v) => v.toLowerCase())),
];

/** GitHub @mentions in a comment body. Deliberately conservative: it must not
 *  match an email address or a path fragment. */
export function mentionsIn(text: string): string[] {
  const matches = text.match(/(?:^|[^\w@/])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)\b/g);
  return (matches ?? []).map((m) => m.slice(m.indexOf("@") + 1).toLowerCase());
}

const shortRepo = (full: string): string => full.split("/").pop() ?? full;
const ghUrl = (repo: string, number: number): string =>
  `https://github.com/${repo}/pull/${number}`;

/** Plain wording for a pull request action. */
function titleFor(event: string, action: string): string {
  if (event !== "pull_request") return action || event;
  switch (action) {
    case "opened":
      return "Pull request opened";
    case "closed":
      return "Pull request closed";
    case "reopened":
      return "Pull request reopened";
    case "ready_for_review":
      return "Ready for review";
    case "converted_to_draft":
      return "Converted to draft";
    case "review_requested":
      return "Review requested";
    case "assigned":
      return "Assigned to you";
    case "synchronize":
      return "New commits";
    default:
      return `Pull request ${action.replace(/_/g, " ")}`;
  }
}

export { CONSOLE_HOST };

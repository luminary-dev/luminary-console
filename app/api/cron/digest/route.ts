// Daily "stalled deals" digest (vercel.json schedules it). Scans every client
// for things that have quietly stalled and pings the STUDIO (email + Telegram)
// so nothing needs manual chasing. Studio-facing only — never emails clients
// (client mail stays operator-triggered). Sends nothing when all is clear.
//
// Auth: identical bearer scheme to the backup cron — the proxy waves
// /api/cron/* past the session gate, so this CRON_SECRET check is the guard.
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getIndex, getClient } from "@/lib/store";
import { emailStudio } from "@/lib/email";
import { sendTelegram, tgEsc } from "@/lib/telegram";
import { overdueSummary, fmtLKR } from "@/lib/money";
import { currentStage } from "@/lib/stage";
import { logActivity } from "@/lib/activity";
import { displayName } from "@/lib/admins";
import { esc } from "@/lib/templates/shell";
import type { ClientRecord } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const ROOT = process.env.ROOT_DOMAIN || "luminary-dev.xyz";
const CONSOLE_HOST = process.env.CONSOLE_HOST || `console.${ROOT}`;
const DAY = 86_400_000;
const STALE_DAYS = 3; // how long something may sit before it's "stalled"

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") || "", "utf8");
  const want = Buffer.from(`Bearer ${secret}`, "utf8");
  return got.length === want.length && timingSafeEqual(got, want);
}

const daysSince = (iso?: string, now = Date.now()): number => {
  const t = Date.parse(iso ?? "");
  return Number.isFinite(t) ? Math.floor((now - t) / DAY) : Infinity;
};

/** The stalled/attention items for one client (empty array = nothing to say). */
function clientIssues(c: ClientRecord, now: number): string[] {
  const issues: string[] = [];

  const quotation = c.docs?.quotation;
  if (quotation?.status === "published" && !c.acceptance && daysSince(quotation.updatedAt, now) >= STALE_DAYS) {
    issues.push(`Quotation unaccepted for ${daysSince(quotation.updatedAt, now)} days`);
  }

  const od = overdueSummary(c, now);
  if (od.count > 0) {
    issues.push(`${od.count} invoice${od.count > 1 ? "s" : ""} overdue (${fmtLKR(od.total)})`);
  }

  // Questionnaire never submitted, though the project has moved past setup.
  const hasDocs = !!(c.docs?.estimate || c.docs?.quotation);
  if (hasDocs && !c.answersAt && daysSince(c.createdAt, now) >= STALE_DAYS) {
    issues.push(`Questionnaire not submitted (${daysSince(c.createdAt, now)} days)`);
  }

  // Designs published but none chosen.
  const pubDesigns = (c.designs ?? []).filter((d) => d.status === "published");
  if (pubDesigns.length > 0 && !c.selectedDesign) {
    const age = Math.min(...pubDesigns.map((d) => daysSince(d.updatedAt, now)));
    if (age >= STALE_DAYS) issues.push(`Design not selected (${age} days)`);
  }

  // Warranty ending within 3 days — a natural care-plan nudge.
  if (currentStage(c) === "warranty") {
    const delivered = Date.parse(c.deliveredAt ?? "");
    if (Number.isFinite(delivered)) {
      const daysLeft = Math.ceil((delivered + 30 * DAY - now) / DAY);
      if (daysLeft >= 0 && daysLeft <= 3) issues.push(`Warranty ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`);
    }
  }

  // Overdue tasks (open tasks past their due date).
  const overdueTasks = (c.tasks ?? []).filter((t) => !t.done && t.due && Date.parse(t.due) < now);
  for (const t of overdueTasks) {
    issues.push(`Task overdue: ${t.text}${t.assignee ? ` (${displayName(t.assignee)})` : ""}`);
  }

  return issues;
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const now = Date.now();
    const index = await getIndex();
    const flagged: { slug: string; company: string; issues: string[] }[] = [];
    for (const e of index) {
      const c = await getClient(e.slug);
      if (!c) continue;
      const issues = clientIssues(c, now);
      if (issues.length) flagged.push({ slug: e.slug, company: e.company, issues });
    }

    if (flagged.length === 0) {
      await logActivity("system", "ran daily digest", "console", "nothing stalled");
      return NextResponse.json({ ok: true, flagged: 0 });
    }

    const totalItems = flagged.reduce((n, f) => n + f.issues.length, 0);

    // Studio email
    await emailStudio(
      `Daily digest — ${totalItems} item${totalItems > 1 ? "s" : ""} need attention`,
      `<p>Things that have stalled or need a nudge across your clients:</p>
${flagged
        .map(
          (f) =>
            `<p style="margin:12px 0 0"><a href="https://${CONSOLE_HOST}/clients/${f.slug}"><b>${esc(f.company)}</b></a></p>
<ul style="margin:4px 0">${f.issues.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`,
        )
        .join("")}
<p style="color:#888;font-size:12px">Sent by the daily digest cron — replies aren't monitored.</p>`,
    );

    // Telegram digest (emojis fine here)
    const tg = [
      `🔔 <b>Daily digest</b> · ${totalItems} item${totalItems > 1 ? "s" : ""}`,
      ...flagged.map(
        (f) =>
          `<b>${tgEsc(f.company)}</b>\n${f.issues.map((i) => `• ${tgEsc(i)}`).join("\n")}\n<a href="https://${CONSOLE_HOST}/clients/${f.slug}">Open →</a>`,
      ),
    ].join("\n\n");
    await sendTelegram(tg);

    await logActivity("system", "ran daily digest", "console", `${flagged.length} client(s), ${totalItems} item(s)`);
    return NextResponse.json({ ok: true, flagged: flagged.length, items: totalItems });
  } catch (e) {
    console.error("Digest cron failed:", e);
    return NextResponse.json({ error: "Digest failed." }, { status: 500 });
  }
}

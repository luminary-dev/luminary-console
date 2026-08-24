// Web Push to the admins' devices — the PWA sibling of lib/telegram.ts.
// Subscriptions are created from the console UI (components/PushToggle) once
// the app is installed to an iPhone home screen (iOS 16.4+) or any desktop
// browser, and stored as one state file. Sending mirrors the Telegram
// contract: guarded (no-ops without VAPID keys), best-effort, never throws,
// so a failed notice can't break the action that triggered it.
import webpush from "web-push";
import { readState, writeState } from "./store";

export type StoredPushSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  /** Operator + device hint captured at subscribe time, for debugging. */
  label?: string;
  createdAt: string;
};

const PATH = "push-subscriptions.json";

function vapidDetails() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  const subject =
    process.env.VAPID_SUBJECT ||
    `mailto:${process.env.STUDIO_EMAIL || `studio@${process.env.ROOT_DOMAIN || "luminary-dev.xyz"}`}`;
  return { subject, publicKey, privateKey };
}

/** The browser needs this to subscribe; null means push isn't configured. */
export const vapidPublicKey = (): string | null => process.env.VAPID_PUBLIC_KEY || null;

export async function listSubscriptions(): Promise<StoredPushSubscription[]> {
  return (await readState<StoredPushSubscription[]>(PATH)) ?? [];
}

/** Add or refresh (by endpoint) one device subscription. */
export async function saveSubscription(
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  label?: string,
): Promise<void> {
  const subs = await listSubscriptions();
  const rest = subs.filter((s) => s.endpoint !== sub.endpoint);
  rest.push({
    endpoint: sub.endpoint,
    keys: sub.keys,
    ...(label ? { label } : {}),
    createdAt: new Date().toISOString(),
  });
  await writeState(PATH, rest);
}

export async function removeSubscription(endpoint: string): Promise<void> {
  const subs = await listSubscriptions();
  await writeState(PATH, subs.filter((s) => s.endpoint !== endpoint));
}

export type PushPayload = {
  title: string;
  body?: string;
  /** Absolute or app-relative URL the notification opens. */
  url?: string;
  /** Collapse key — a later notice with the same tag replaces the earlier one. */
  tag?: string;
};

/** Send a notification to every subscribed device (or one, via `endpoint`).
 *  Expired subscriptions (endpoint gone: 404/410) are pruned as they surface.
 *  Returns how many sends succeeded. */
export async function sendPush(
  payload: PushPayload,
  opts?: { endpoint?: string },
): Promise<number> {
  const details = vapidDetails();
  if (!details) return 0; // not configured — silent no-op, like Telegram
  try {
    let subs = await listSubscriptions();
    if (opts?.endpoint) subs = subs.filter((s) => s.endpoint === opts.endpoint);
    if (subs.length === 0) return 0;
    const body = JSON.stringify(payload);
    const dead: string[] = [];
    let sent = 0;
    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: sub.keys },
            body,
            { vapidDetails: details, TTL: 24 * 60 * 60 },
          );
          sent++;
        } catch (e) {
          const code = (e as { statusCode?: number })?.statusCode;
          if (code === 404 || code === 410) dead.push(sub.endpoint);
          else console.error("Push send failed:", code ?? e);
        }
      }),
    );
    if (dead.length) {
      const remaining = (await listSubscriptions()).filter((s) => !dead.includes(s.endpoint));
      await writeState(PATH, remaining);
    }
    return sent;
  } catch (e) {
    console.error("Push send error:", e);
    return 0;
  }
}

/** Reverse of tgEsc — call sites pass tgNotice-ready (HTML-escaped) detail
 *  lines; a push body is plain text, so the entities go back. */
const unesc = (s: string) =>
  String(s ?? "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Push twin of tgNotice — same inputs, plain-text rendering:
 *  title "{Title} · {Company}", body = detail lines, click opens url.
 *  The emoji is Telegram styling only — lock-screen titles stay plain. */
export async function sendPushNotice(opts: {
  /** Accepted for studioNotice compatibility; Telegram-only styling. */
  emoji?: string;
  title: string;
  company: string;
  lines?: string[];
  url: string;
}): Promise<number> {
  return sendPush({
    title: `${opts.title} · ${opts.company}`,
    body: (opts.lines ?? []).filter((l) => l && l.trim()).map(unesc).join("\n"),
    url: opts.url,
  });
}

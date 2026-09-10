import { Resend } from "resend";
import { logger } from "@/lib/logger";

const TO = process.env.STUDIO_EMAIL || "support@luminary-dev.xyz";
const FROM = process.env.SENDER || "Luminary <questionnaire@luminary-dev.xyz>";

type Attachment = { filename: string; content: Buffer };

/** Returns whether the mail actually went out. Most callers ignore it — a
 *  failed notification must never fail the operation that triggered it — but
 *  the pre-deletion archive does not, because there that email IS the backup. */
export async function emailStudio(
  subject: string,
  html: string,
  attachments: Attachment[] = [],
  replyTo?: string,
): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    logger.warn("RESEND_API_KEY missing — studio email skipped", { subject });
    return false;
  }
  const resend = new Resend(key);
  const { error } = await resend.emails.send({
    from: FROM,
    to: [TO],
    ...(replyTo ? { replyTo } : {}),
    subject,
    html,
    ...(attachments.length ? { attachments } : {}),
  });
  if (error) logger.error("Studio email failed", { err: error });
  return !error;
}

export async function emailAddresses(
  to: string[],
  subject: string,
  html: string,
  attachments: Attachment[] = [],
  opts: { from?: string; noReply?: boolean } = {},
): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const resend = new Resend(key);
  const { error } = await resend.emails.send({
    from: opts.from || FROM,
    to,
    ...(opts.noReply ? {} : { replyTo: TO }),
    subject,
    html,
    ...(attachments.length ? { attachments } : {}),
  });
  if (error) logger.error("Copy email failed", { err: error });
  return !error;
}

/** Sender for automated system mail (sign-in codes) — not a real mailbox. */
export const NO_REPLY = "Luminary Console <no_reply@luminary-dev.xyz>";

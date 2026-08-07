import { Resend } from "resend";

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
    console.warn("RESEND_API_KEY missing — studio email skipped:", subject);
    return false;
  }
  const resend = new Resend(key);
  const { error } = await resend.emails.send({
    from: FROM,
    to: [TO],
    replyTo: replyTo || undefined,
    subject,
    html,
    attachments: attachments.length ? attachments : undefined,
  });
  if (error) console.error("Studio email failed:", error);
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
    replyTo: opts.noReply ? undefined : TO,
    subject,
    html,
    attachments: attachments.length ? attachments : undefined,
  });
  if (error) console.error("Copy email failed:", error);
  return !error;
}

/** Sender for automated system mail (sign-in codes) — not a real mailbox. */
export const NO_REPLY = "Luminary Console <no_reply@luminary-dev.xyz>";

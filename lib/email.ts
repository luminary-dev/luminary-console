import { Resend } from "resend";

const TO = process.env.STUDIO_EMAIL || "support@luminary-dev.xyz";
const FROM = process.env.SENDER || "Luminary <questionnaire@luminary-dev.xyz>";

type Attachment = { filename: string; content: Buffer };

export async function emailStudio(
  subject: string,
  html: string,
  attachments: Attachment[] = [],
  replyTo?: string,
): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("RESEND_API_KEY missing — studio email skipped:", subject);
    return;
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
}

export async function emailAddresses(
  to: string[],
  subject: string,
  html: string,
  attachments: Attachment[] = [],
): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const resend = new Resend(key);
  const { error } = await resend.emails.send({
    from: FROM,
    to,
    replyTo: TO,
    subject,
    html,
    attachments: attachments.length ? attachments : undefined,
  });
  if (error) console.error("Copy email failed:", error);
  return !error;
}

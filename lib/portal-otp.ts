// One-time email confirmation for the binding portal actions — accepting a
// quotation and e-signing the contract (AUDIT.md SEC-01).
//
// The portal is addressed by a guessable, company-name-derived slug, and the
// accept/sign actions recorded a legally-styled acceptance under a typed name
// with nothing unguessable to prove the client authorised it. This gates those
// two actions behind a 6-digit code emailed to the client's ON-FILE address:
// only someone who can read that mailbox can confirm.
//
// It reuses lib/otp wholesale (keyed HMAC of the code, 10-minute TTL,
// attempt-limit, resend throttle), keyed by `portal:<slug>:<action>` so an
// accept code and a sign code are separate slots and neither collides with the
// operator login OTP. lib/otp mints and stores the code; we email it here.
import { issueOtp, verifyOtp, type OtpResult } from "@/lib/otp";
import { emailAddresses, NO_REPLY } from "@/lib/email";
import { esc } from "@/lib/templates/shell";

export type PortalAction = "accept" | "sign";

const otpKey = (slug: string, action: PortalAction) => `portal:${slug}:${action}`;

/** Email a fresh code to the client. Returns:
 *  - "sent"      a code was emailed (caller asks the client for it),
 *  - "throttled" one was requested too recently (a code is already in flight),
 *  - "noEmail"   no address on file, so the caller falls back to name-only. */
export async function requestPortalCode(
  slug: string,
  action: PortalAction,
  email: string | undefined,
  docLabel: string,
): Promise<"sent" | "throttled" | "noEmail"> {
  if (!email) return "noEmail";
  const issued = await issueOtp(otpKey(slug, action));
  if ("retryInMs" in issued) return "throttled";
  await emailAddresses(
    [email],
    `Your confirmation code for the ${docLabel}`,
    `<p>Enter this code on the ${esc(docLabel)} page to confirm:</p>
<p style="font-size:28px;font-weight:700;letter-spacing:.3em;font-family:monospace;margin:16px 0;">${issued.code}</p>
<p style="color:#6b7280;font-size:13px;">It expires in 10 minutes. If you didn't ask to confirm this document, you can ignore this email.</p>`,
    [],
    { from: NO_REPLY, noReply: true },
  );
  return "sent";
}

/** Verify a code the client entered. */
export function verifyPortalCode(slug: string, action: PortalAction, code: string): Promise<OtpResult> {
  return verifyOtp(otpKey(slug, action), code);
}

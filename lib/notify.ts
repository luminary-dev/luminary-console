// One studio notice, every channel: Telegram group + Web Push to the admins'
// installed console apps. Both legs are independently guarded and best-effort
// (each no-ops when its env isn't set and never throws), so call sites keep
// the exact contract they had with sendTelegram(tgNotice(...)).
import { sendTelegram, tgNotice } from "./telegram";
import { sendPushNotice } from "./push";

export type StudioNotice = {
  title: string;
  company: string;
  /** Detail lines, already tgEsc-escaped (push un-escapes for plain text). */
  lines?: string[];
  url: string;
};

export async function studioNotice(opts: StudioNotice): Promise<void> {
  await Promise.all([sendTelegram(tgNotice(opts)), sendPushNotice(opts)]);
}

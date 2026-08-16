// Studio Telegram notifications — a guarded, best-effort ping to the admins'
// group, mirroring emailStudio (lib/email.ts). No-ops when TELEGRAM_BOT_TOKEN /
// TELEGRAM_CHAT_ID aren't set, and never throws, so a failed notice can't break
// the portal action that triggered it. `text` may use Telegram HTML tags
// (<b>, <a href>); escape dynamic values with tgEsc first.
const TG_API = "https://api.telegram.org";

/** Escape the three characters Telegram's HTML parse mode is strict about. */
export function tgEsc(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Send a notification to the studio Telegram chat. Returns whether it sent. */
export async function sendTelegram(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn("TELEGRAM_BOT_TOKEN/CHAT_ID missing — telegram notice skipped");
    return false;
  }
  try {
    const res = await fetch(`${TG_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      console.error("Telegram send failed:", res.status, await res.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (e) {
    console.error("Telegram send error:", e);
    return false;
  }
}

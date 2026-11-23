"use client";

// The send queue: one shop at a time, with its message already written.
//
// Open the chat, send, come back, press "I sent it". That press is what the
// rest of the team sees, so it is the only thing that advances the queue: a
// message that was opened but not sent stays where it is.
//
// Follow-ups that are due come first, then new shops up to the daily cap.
// "Skip for today" is a personal, this-visit-only choice and is not stored.
import { useEffect, useMemo, useState } from "react";
import {
  DAILY_CAP,
  OFFER,
  buildQueue,
  channelOf,
  firstsToday,
  messageFor,
  sendLink,
  type Lang,
  type Lead,
  type ProgressMap,
} from "@/lib/sales";
import CopyText from "./CopyText";
import { useSalesProgress } from "./useSalesProgress";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What we know the shop's page looked like when it was last opened. */
function proof(lead: Lead): string {
  const parts: string[] = [];
  if (lead.followers !== null) parts.push(`${lead.followers.toLocaleString("en-US")} followers`);
  if (lead.posts !== null) parts.push(`${lead.posts.toLocaleString("en-US")} posts`);
  const seen = lead.checked ? `Checked ${lead.checked}` : "Checked";
  return `${seen}: instagram.com/${lead.ig}${parts.length ? `, ${parts.join(", ")}` : ""}.`;
}

export default function SalesQueue({
  leads,
  initialProgress,
  operator,
  me,
  now: serverNow,
}: {
  leads: Lead[];
  initialProgress: ProgressMap;
  /** The signed-in operator's email: the daily cap is counted per person. */
  operator: string;
  /** Their first name as a shop will read it, or "" when it is not known. */
  me: string;
  /** The server's clock at render, so the first paint matches the markup. */
  now: number;
}) {
  const { progress, busy, error, act, refresh } = useSalesProgress(initialProgress);
  const [now, setNow] = useState(serverNow);
  const [skip, setSkip] = useState<ReadonlySet<string>>(new Set());
  const [lang, setLang] = useState<Lang>("en");
  const [name, setName] = useState(me);

  // Keep "today" honest in a tab left open overnight: the day is re-read
  // whenever the tab comes back, alongside the team's progress.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") setNow(Date.now());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const queue = useMemo(() => buildQueue(leads, progress, now, operator, skip), [leads, progress, now, operator, skip]);
  const sentToday = firstsToday(progress, operator, now);
  const item = queue.items[0];

  const summary = (
    <p className="sales-progress">
      Today: {sentToday} of {DAILY_CAP} first messages sent by you
      {queue.due > 0 ? `, ${plural(queue.due, "follow-up")} due` : ""}
    </p>
  );

  if (!item) {
    const capped = queue.room === 0 && queue.fresh > 0;
    return (
      <section className="card" aria-labelledby="sales-q-title">
        <h2 className="sr-only" id="sales-q-title">Send queue</h2>
        <h3>{capped ? "Done for today." : queue.fresh > 0 ? "Nothing left in today's queue." : "Nothing left to send."}</h3>
        <p className="empty-note">
          {capped
            ? `That is ${DAILY_CAP} new shops today. More than this from one account starts to look like spam to WhatsApp and Instagram. Check your replies instead.`
            : skip.size > 0
              ? "You skipped the rest for today. They are back tomorrow, or reload to see them now."
              : "Follow-ups appear here two and five days after each first message. Import more shops when the list runs dry."}
        </p>
        {summary}
        <button type="button" className="btn ghost small" style={{ marginTop: 14 }} onClick={() => void refresh()}>
          Check for updates
        </button>
      </section>
    );
  }

  const { lead, step, days } = item;
  const previewUrl = progress[lead.id]?.previewUrl;
  const message = messageFor(lead, step, { me: name.trim(), previewUrl, lang });
  const channel = channelOf(lead);
  const link = sendLink(lead, message);
  const ready = name.trim().length > 0;
  const kind =
    step === 0 ? "First message" : step === 1 ? `Follow-up, sent ${plural(days ?? 0, "day")} ago` : "Last follow-up";
  const where = [lead.nicheLabel, lead.city].filter(Boolean).join(" · ");

  const drop = (id: string) => setSkip((s) => new Set([...s, id]));

  return (
    <section className="card" aria-labelledby="sales-q-title">
      <div className="sales-q">
        <span className={`sales-q-kind${step ? " is-due" : ""}`}>{kind}</span>
        <div>
          <h2 id="sales-q-title">{lead.name}</h2>
          {where && <p className="sales-q-where">{where}</p>}
        </div>
        {lead.ig && (
          <p className="sales-proof">
            {proof(lead)}{" "}
            <a href={`https://www.instagram.com/${encodeURIComponent(lead.ig)}/`} target="_blank" rel="noopener noreferrer">
              See their page
            </a>
          </p>
        )}

        {!me && (
          <label className="q-field">
            <span className="q-label">Your first name, as the shop will read it</span>
            <input
              className="q-line"
              type="text"
              autoComplete="given-name"
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        )}

        {step === 0 && (
          <div className="sales-lang" role="group" aria-label="Message language">
            <button type="button" className="btn ghost small" aria-pressed={lang === "en"} onClick={() => setLang("en")}>
              English
            </button>
            <button type="button" className="btn ghost small" aria-pressed={lang === "si"} onClick={() => setLang("si")}>
              Sinhala
            </button>
          </div>
        )}

        <p className="sales-msg">{message}</p>

        <div className="sales-steps">
          {channel === "whatsapp" && link ? (
            ready ? (
              <a className="btn sales-big" href={link} target="_blank" rel="noopener noreferrer">
                Open WhatsApp with this message
              </a>
            ) : (
              <button type="button" className="btn sales-big" disabled>
                Open WhatsApp with this message
              </button>
            )
          ) : (
            <>
              <CopyText text={message} label="1. Copy the message" className="btn sales-big" />
              {link && (
                <a className="btn ghost sales-big" href={link} target="_blank" rel="noopener noreferrer">
                  2. Open their Instagram chat as @{OFFER.instagram}
                </a>
              )}
            </>
          )}
        </div>

        <div className="sales-row">
          <button
            type="button"
            className="btn ghost"
            disabled={busy || !ready}
            onClick={() => void act(lead.id, { type: "sent", step })}
          >
            I sent it
          </button>
          <button type="button" className="btn ghost" disabled={busy} onClick={() => drop(lead.id)}>
            Skip for today
          </button>
          {step === 0 ? (
            <button
              type="button"
              className="btn ghost"
              disabled={busy}
              onClick={() => void act(lead.id, { type: "status", status: "no" })}
            >
              Not a fit
            </button>
          ) : (
            <button
              type="button"
              className="btn ghost"
              disabled={busy}
              onClick={() => void act(lead.id, { type: "status", status: "replied" })}
            >
              They already replied
            </button>
          )}
        </div>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <p className="empty-note" style={{ marginTop: 0 }}>
          {plural(queue.items.length - 1, "more shop")} in today&apos;s queue.
          {step === 0 ? " Before sending, glance at their page: is it active, and is the opening line true?" : ""}
        </p>
      </div>
      {summary}
    </section>
  );
}

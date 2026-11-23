"use client";

// Every shop on the board, with where it stands and who last touched it.
//
// The queue is for sending; this is for everything else: moving a shop on when
// it replies, recording a note or its preview link, sending out of turn, and
// seeing the ones that were held back and why.
import { useMemo, useState } from "react";
import { displayName } from "@/lib/admins";
import {
  MAX_NOTE,
  STATUSES,
  STATUS_LABEL,
  channelOf,
  messageFor,
  nextStep,
  sendLink,
  statusOf,
  type Lead,
  type Progress,
  type ProgressMap,
  type Status,
  type Step,
} from "@/lib/sales";
import RelativeTime from "@/components/RelativeTime";
import CopyText from "./CopyText";
import { useSalesProgress } from "./useSalesProgress";

type Filter = "ready" | "new" | "sent" | "talking" | "closed" | "held";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "ready", label: "All" },
  { id: "new", label: "Not contacted" },
  { id: "sent", label: "Messaged" },
  { id: "talking", label: "In conversation" },
  { id: "closed", label: "Closed" },
  { id: "held", label: "Held back" },
];

function matches(filter: Filter, lead: Lead, status: Status): boolean {
  if (filter === "held") return lead.hold;
  if (lead.hold) return false;
  if (filter === "ready") return true;
  if (filter === "talking") return status === "replied" || status === "keen";
  if (filter === "closed") return status === "won" || status === "no";
  return status === filter;
}

function Who({ p, now }: { p: Progress | undefined; now: number }) {
  if (!p) return null;
  if (p.status === "sent" && p.sentAt) {
    return (
      <span className="sales-shop-who">
        {displayName(p.sentBy ?? "")} messaged <RelativeTime at={p.sentAt} />
        {p.followUps > 0 ? `, ${p.followUps} follow-up${p.followUps === 1 ? "" : "s"}` : ""}
      </span>
    );
  }
  if (p.status === "new" && !p.note && !p.previewUrl) return null;
  // `now` only orders the server and first client paint; RelativeTime re-derives.
  void now;
  return (
    <span className="sales-shop-who">
      {displayName(p.updatedBy)} updated <RelativeTime at={p.updatedAt} />
    </span>
  );
}

function ShopRow({
  lead,
  p,
  me,
  now,
  busy,
  act,
}: {
  lead: Lead;
  p: Progress | undefined;
  me: string;
  now: number;
  busy: boolean;
  act: ReturnType<typeof useSalesProgress>["act"];
}) {
  const status = p?.status ?? "new";
  const [note, setNote] = useState(p?.note ?? "");
  const [preview, setPreview] = useState(p?.previewUrl ?? "");
  const changed = note.trim() !== (p?.note ?? "") || preview.trim() !== (p?.previewUrl ?? "");

  // The message this shop would get now: the one that is due, or the first
  // message again for a shop that is not in the queue, so it can be re-read.
  const step: Step = nextStep(lead, p, now) ?? 0;
  const message = messageFor(lead, step, { me, previewUrl: p?.previewUrl });
  const link = sendLink(lead, message);
  const channel = channelOf(lead);
  const where = [lead.nicheLabel, lead.city].filter(Boolean).join(" · ");

  return (
    <li>
      <details className="sales-shop">
        <summary>
          <span className="sales-shop-name">
            {lead.name}
            {where && <small>{where}</small>}
          </span>
          <Who p={p} now={now} />
          <span className={`pill${status === "won" ? "" : " grey"}`}>
            <i />
            {lead.hold ? "Held back" : STATUS_LABEL[status]}
          </span>
        </summary>
        <div className="sales-shop-body">
          <dl className="sales-facts">
            {lead.hold && lead.why && (
              <div>
                <dt>Why it is held back</dt>
                <dd>{lead.why}</dd>
              </div>
            )}
            {lead.sells && (
              <div>
                <dt>Sells</dt>
                <dd>{lead.sells}</dd>
              </div>
            )}
            {lead.check && (
              <div>
                <dt>Website check</dt>
                <dd>{lead.check}</dd>
              </div>
            )}
            <div>
              <dt>Reach them</dt>
              <dd>
                {channel === "whatsapp" ? `WhatsApp ${lead.wa}` : channel === "instagram" ? "Instagram DM" : "No contact found"}
                {lead.phone ? `. ${lead.phone}` : ""}
                {lead.ig && (
                  <>
                    {" "}
                    <a
                      className="sales-link"
                      href={`https://www.instagram.com/${encodeURIComponent(lead.ig)}/`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      instagram.com/{lead.ig}
                    </a>
                  </>
                )}
              </dd>
            </div>
          </dl>

          <div className="sales-fields">
            <label>
              Status
              <select
                className="q-line"
                value={status}
                disabled={busy}
                onChange={(e) => void act(lead.id, { type: "status", status: e.target.value as Status })}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Their preview link
              <input
                className="q-line"
                type="url"
                inputMode="url"
                placeholder="https://"
                value={preview}
                onChange={(e) => setPreview(e.target.value)}
              />
            </label>
          </div>
          <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--muted)" }}>
            Note for the team
            <textarea
              className="q-box"
              rows={2}
              maxLength={MAX_NOTE}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <div className="sales-row">
            <button
              type="button"
              className="btn ghost small"
              style={{ flex: "0 0 auto" }}
              disabled={busy || !changed}
              onClick={() => void act(lead.id, { type: "details", note, previewUrl: preview })}
            >
              Save note and link
            </button>
          </div>

          {!lead.hold && channel !== "none" && (
            <>
              <p className="sales-msg">{message}</p>
              <div className="sales-row">
                <CopyText text={message} label="Copy message" />
                {link && (
                  <a className="btn ghost small" style={{ flex: "0 0 auto" }} href={link} target="_blank" rel="noopener noreferrer">
                    {channel === "whatsapp" ? "Open WhatsApp" : "Open Instagram chat"}
                  </a>
                )}
              </div>
            </>
          )}
        </div>
      </details>
    </li>
  );
}

export default function ShopList({
  leads,
  initialProgress,
  me,
  now,
}: {
  leads: Lead[];
  initialProgress: ProgressMap;
  me: string;
  now: number;
}) {
  const { progress, busy, error, act } = useSalesProgress(initialProgress);
  const [filter, setFilter] = useState<Filter>("ready");

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { ready: 0, new: 0, sent: 0, talking: 0, closed: 0, held: 0 };
    for (const lead of leads) {
      const status = statusOf(progress, lead.id);
      for (const f of FILTERS) if (matches(f.id, lead, status)) c[f.id]++;
    }
    return c;
  }, [leads, progress]);

  const shown = leads.filter((lead) => matches(filter, lead, statusOf(progress, lead.id)));

  return (
    <section className="card" aria-labelledby="sales-shops-title">
      <h3 id="sales-shops-title">Shops</h3>
      <div className="sales-filters" role="group" aria-label="Show">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className="btn ghost small"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
          >
            {f.label} {counts[f.id]}
          </button>
        ))}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {shown.length === 0 ? (
        <p className="empty-note">No shops here yet.</p>
      ) : (
        <ul className="sales-shops">
          {shown.map((lead) => {
            const p = progress[lead.id];
            // Keyed on the stored note and link, so a save (or a teammate's
            // edit arriving on refresh) resets the row's fields to what is
            // stored instead of leaving a stale draft in them.
            return (
              <ShopRow
                key={`${lead.id}|${p?.note ?? ""}|${p?.previewUrl ?? ""}`}
                lead={lead}
                p={p}
                me={me}
                now={now}
                busy={busy}
                act={act}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}

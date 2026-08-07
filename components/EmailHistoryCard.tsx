// Every client-facing email the console has sent, newest first. The record
// is the only sent-mail history there is (Resend isn't queried), so this is
// what answers "did we actually send them the quotation?".
import type { ClientRecord } from "@/lib/types";
import { resolveDoc } from "@/lib/doclabels";
import { whenLabel } from "@/lib/time";

export default function EmailHistoryCard({ client }: { client: ClientRecord }) {
  const log = [...(client.emailLog ?? [])].reverse();

  return (
    <div className="card">
      <div className="ask-head">
        <h3>Emails sent</h3>
        {log.length > 0 && (
          <span className="save-state">
            {log.length} email{log.length > 1 ? "s" : ""}
          </span>
        )}
      </div>
      {log.length === 0 ? (
        <p className="empty-note">
          Nothing sent to the client yet — every email leaves from this page, never automatically.
        </p>
      ) : (
        <div style={{ marginTop: 8 }}>
          {log.map((e, i) => (
            <div className="log-row" key={`${e.at}-${i}`}>
              <div style={{ fontWeight: 600 }}>{e.subject}</div>
              <div className="log-meta">
                {whenLabel(e.at)} · to {e.to}
                {e.docs?.length ? (
                  <>
                    {" · "}
                    {e.docs
                      .map((k) => resolveDoc(client, k)?.no ?? k)
                      .join(", ")}
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

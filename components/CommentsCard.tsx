// Questions the client left on their documents, newest first, each tagged
// with the document number it refers to. Read-only: replies happen by email,
// so there is nothing to click and no state to keep.
import type { ClientRecord } from "@/lib/types";
import { resolveDoc } from "@/lib/doclabels";
import { whenLabel } from "@/lib/time";

export default function CommentsCard({ client }: { client: ClientRecord }) {
  const comments = [...(client.comments ?? [])].reverse();

  return (
    <div className="card">
      <div className="ask-head">
        <h3>Client questions</h3>
        {comments.length > 0 && (
          <span className="save-state">
            {comments.length} question{comments.length > 1 ? "s" : ""}
          </span>
        )}
      </div>
      {comments.length === 0 ? (
        <p className="empty-note">
          Nothing asked yet. The portal shows a question box against every published document —
          anything sent lands here and in the studio inbox.
        </p>
      ) : (
        <div style={{ marginTop: 8 }}>
          {comments.map((c, i) => {
            // A document deleted after the question was asked still deserves
            // its key shown, so the question keeps its context.
            const doc = resolveDoc(client, c.doc);
            return (
              <div className="log-row" key={`${c.at}-${i}`}>
                <div>
                  <b>{c.by}</b>{" "}
                  <span style={{ color: "var(--muted)" }}>
                    on {doc ? doc.label.toLowerCase() : c.doc}
                  </span>{" "}
                  <span className="mono" style={{ fontSize: 12 }}>
                    {doc?.no ?? c.doc}
                  </span>
                </div>
                <div className="quote-text">{c.text}</div>
                <div className="log-meta">{whenLabel(c.at)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

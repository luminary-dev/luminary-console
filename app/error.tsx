"use client";

// Error boundary for every console segment under the root layout (LC-020).
// Before this existed, a transient R2 read failure inside a server component
// propagated all the way out and Next rendered its own blank error screen: no
// explanation, no way back, no retry. Every store read in this app is a read,
// not a write, so the honest thing to tell the operator is that nothing was
// lost and the action worth taking is "try again".
//
// Nothing from `error` is rendered: the message can carry R2 keys or provider
// text. The digest is the correlation handle, and it is safe by construction.
import { useEffect } from "react";
import Link from "next/link";

export default function ConsoleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Console error boundary caught a failed render. Digest:", error.digest ?? "none");
  }, [error]);

  return (
    <main className="wrap" style={{ paddingBottom: 80 }}>
      <div className="topbar">
        <div className="brand">
          Luminary<span>.</span>
          <small>Console</small>
        </div>
      </div>
      {/* Skip-link target. The topbar lives inside <main> on every console
          page, so the jump lands here, after the nav, and the next Tab
          continues into the content. tabIndex makes it focusable, which is
          what moves focus rather than only the scroll position. */}
      <div id="main-content" tabIndex={-1} />


      <div className="card">
        <h3>This page could not load</h3>
        <p style={{ color: "var(--muted)", fontSize: 13.5, marginTop: 6, lineHeight: 1.65 }}>
          Something the console needed to read did not come back. This is almost always the record
          store being briefly unreachable, and it usually clears on a retry. Nothing has been changed
          or lost: loading a page only reads.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
          <button className="btn" onClick={() => reset()}>
            Try again
          </button>
          <Link className="btn ghost" href="/">
            Back to the dashboard
          </Link>
        </div>
        {error.digest && (
          <p className="k" style={{ marginTop: 16 }}>
            Reference {error.digest}
          </p>
        )}
      </div>
    </main>
  );
}

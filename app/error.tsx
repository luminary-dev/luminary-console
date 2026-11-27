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
import ConsoleShell from "@/components/shell/ConsoleShell";

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
    <ConsoleShell title="This page could not load" purpose={null}>
      <div className="card">
        <h3>Nothing has been lost</h3>
        <p className="empty-note" style={{ marginTop: 8 }}>
          Something the console needed to read did not come back. This is almost always the record
          store being briefly unreachable, and it usually clears on a retry. Nothing has been changed
          or lost: loading a page only reads.
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
          <button className="btn" onClick={() => reset()}>
            Try again
          </button>
          <Link className="btn ghost" href="/">
            Back to Today
          </Link>
        </div>
        {error.digest && (
          <p className="k" style={{ marginTop: 16 }}>
            Reference {error.digest}
          </p>
        )}
      </div>
    </ConsoleShell>
  );
}

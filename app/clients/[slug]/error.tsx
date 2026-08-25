"use client";

// Error boundary for one client's page (LC-020). It sits below app/error.tsx
// so a failure here keeps the rest of the console reachable, and it can say
// something the generic boundary cannot: which client failed to load, and
// that the record itself is intact even when the page will not render.
//
// Only the digest is surfaced. The error message can carry store keys and
// provider text and must not reach the browser.
import { useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

export default function ClientError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const params = useParams<{ slug: string }>();
  const slug = typeof params?.slug === "string" ? params.slug : "";

  useEffect(() => {
    console.error("Client page error boundary caught a failed render. Digest:", error.digest ?? "none");
  }, [error]);

  return (
    <main className="wrap" style={{ paddingBottom: 80 }}>
      <div className="topbar">
        <div className="brand">
          Luminary<span>.</span>
          <small>Console</small>
        </div>
        <Link className="btn ghost small" href="/">
          Dashboard
        </Link>
      </div>
      {/* Skip-link target. The topbar lives inside <main> on every console
          page, so the jump lands here, after the nav, and the next Tab
          continues into the content. tabIndex makes it focusable, which is
          what moves focus rather than only the scroll position. */}
      <div id="main-content" tabIndex={-1} />


      <div className="card">
        <h3>This client could not be loaded</h3>
        <p style={{ color: "var(--muted)", fontSize: 13.5, marginTop: 6, lineHeight: 1.65 }}>
          {slug ? (
            <>
              The record for <b className="mono">{slug}</b> did not come back from the store.
            </>
          ) : (
            <>The record did not come back from the store.</>
          )}{" "}
          The record has not been changed: opening a client only reads it. A retry is usually enough,
          and the client&apos;s documents and portal stay live either way.
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

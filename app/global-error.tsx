"use client";

// Last resort (LC-020): this replaces the root layout itself, so it is what
// renders when the failure happened in the layout, in the theme cookie read,
// or anywhere else above the segment boundaries. It must therefore emit its
// own <html> and <body>.
//
// It deliberately carries its own inline styles rather than depending on the
// stylesheet or the font links: the reason we are here may be that the layout
// never rendered. The palette below is the same two ground colours the layout
// paints inline, so the page still matches the theme it was headed for.
import { useEffect } from "react";

const SANS =
  "var(--font-outfit), ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global error boundary caught a failed render. Digest:", error.digest ?? "none");
  }, [error]);

  return (
    <html lang="en">
      <head>
        <style>{`
          :root { color-scheme: light dark; }
          html { background: #f0f0ee; }
          body { margin: 0; background: #f0f0ee; color: #0d0d0f; font-family: ${SANS}; }
          .ge-card { background: #ffffff; border: 1px solid rgba(0,0,0,.09); }
          .ge-btn { background: #84cc16; color: #0d0d0f; }
          .ge-ref { color: #545965; }
          @media (prefers-color-scheme: dark) {
            html, body { background: #050506; color: #f4f4f5; }
            .ge-card { background: #0b0b0d; border-color: rgba(255,255,255,.09); }
            .ge-btn { background: #a3e635; color: #0d0d0f; }
            .ge-ref { color: #9a9aa3; }
          }
        `}</style>
      </head>
      <body>
        <main
          style={{
            width: 560,
            maxWidth: "calc(100% - 32px)",
            margin: "14vh auto 0",
          }}
        >
          <div
            className="ge-card"
            style={{ borderRadius: 14, padding: "28px 28px", boxSizing: "border-box" }}
          >
            <h1 style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em", margin: 0 }}>
              The console could not start
            </h1>
            <p style={{ fontSize: 14, lineHeight: 1.65, marginTop: 12, opacity: 0.75 }}>
              Something failed before any page could be drawn. Nothing has been changed or lost. Try
              again, and if it keeps happening, the reference below identifies this exact failure in
              the logs.
            </p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 20 }}>
              <button
                className="ge-btn"
                onClick={() => reset()}
                style={{
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 14,
                  fontWeight: 600,
                  borderRadius: 100,
                  padding: "12px 24px",
                }}
              >
                Try again
              </button>
              <a
                href="/"
                style={{
                  border: "1px solid rgba(128,128,128,.4)",
                  color: "inherit",
                  textDecoration: "none",
                  fontSize: 14,
                  fontWeight: 500,
                  borderRadius: 100,
                  padding: "12px 24px",
                }}
              >
                Back to the dashboard
              </a>
            </div>
            {error.digest && (
              <p
                className="ge-ref"
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  marginTop: 20,
                }}
              >
                Reference {error.digest}
              </p>
            )}
          </div>
        </main>
      </body>
    </html>
  );
}

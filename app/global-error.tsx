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
          /* The console's two palettes, by hand: this page renders without
             the stylesheet. Values are the tokens in app/globals.css. */
          :root { color-scheme: light dark; }
          html { background: #F3EEE2; }
          body { margin: 0; background: #F3EEE2; color: #191612; font-family: ${SANS}; }
          .ge-card { background: #FBF8F0; border: 2px solid #201C15; box-shadow: 3px 3px 0 0 rgba(32,28,21,.14); }
          .ge-btn { background: #6FA80B; color: #12200A; border: 2px solid #201C15; box-shadow: 0 2px 0 0 #201C15; }
          .ge-ref { color: #5B5648; }
          @media (prefers-color-scheme: dark) {
            html, body { background: #0F1518; color: #ECE5D6; }
            .ge-card { background: #1A2126; border-color: #46545B; box-shadow: 3px 3px 0 0 rgba(0,0,0,.45); }
            .ge-btn { background: #9AE027; color: #0E1407; border-color: #46545B; box-shadow: 0 2px 0 0 #0A0F11; }
            .ge-ref { color: #A5AEA9; }
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
            style={{ borderRadius: 14, padding: "26px 28px", boxSizing: "border-box" }}
          >
            <h1 style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em", margin: 0 }}>
              The console could not start
            </h1>
            <p style={{ fontSize: 13.5, lineHeight: 1.65, marginTop: 10, opacity: 0.75 }}>
              Something failed before any page could be drawn. Nothing has been changed or lost. Try
              again, and if it keeps happening, the reference below identifies this exact failure in
              the logs.
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
              <button
                className="ge-btn"
                onClick={() => reset()}
                style={{
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 13.5,
                  fontWeight: 700,
                  borderRadius: 100,
                  padding: "10px 22px",
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
                  fontSize: 13.5,
                  fontWeight: 600,
                  borderRadius: 100,
                  padding: "10px 22px",
                }}
              >
                Back to the dashboard
              </a>
            </div>
            {error.digest && (
              <p
                className="ge-ref"
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: ".14em",
                  textTransform: "uppercase",
                  marginTop: 18,
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

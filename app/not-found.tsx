// The console's 404 (LC-020's missing sibling). Where the personality lives:
// the mascot, a sprung gadget, and one sticker back to the hub.
//
// Rendered inside the root layout, so the stylesheet, the fonts and the theme
// are all present. Nothing here reads the store: a page that is about a
// missing thing must not itself depend on anything that can go missing.
import Link from "next/link";
import Illustration from "@/components/Illustration";
import { MAIN_ID } from "@/components/SkipLink";

export const metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <main className="wrap" style={{ paddingBottom: 80 }}>
      <div className="topbar">
        <div className="brand">
          <Link href="/">
            Luminary<span>.</span>
          </Link>
          <small>Console</small>
        </div>
      </div>
      <div id={MAIN_ID} tabIndex={-1} />

      <div className="card panel--hero">
        <div className="lost">
          <div className="lost__art">
            <Illustration id="error-404" sizes="(max-width: 600px) 60vw, 260px" />
          </div>
          <p className="lost__code" aria-hidden="true">
            4<span>0</span>4
          </p>
          <h1 className="page-title" style={{ fontSize: "clamp(24px, 4vw, 32px)", marginTop: 0 }}>
            Nothing on this bench
          </h1>
          <p>
            There is no page at this address. The link may be old, the client may have been
            deleted, or a character went missing on the way here.
          </p>
          <div className="lost__actions">
            <Link className="btn" href="/">
              Back to the dashboard
            </Link>
            <Link className="btn ghost" href="/clients">
              All clients
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

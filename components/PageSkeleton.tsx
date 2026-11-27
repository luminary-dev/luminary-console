// Instant route-level fallback (AUDIT.md UI-09). The console pages render
// fully server-side and are force-dynamic, so without a loading boundary the
// App Router holds the previous route on screen with no feedback while the
// next server render — which for Today and the client list reads every
// record — runs. A lightweight skeleton gives immediate feedback; the shimmer
// is neutralised under prefers-reduced-motion by the global rule in
// globals.css.
//
// It is drawn in the same column a page is, so it appears beside the menu
// (which the root layout keeps on screen) and the heading lands where the real
// one will. `current` gives it the real title when the section is known.
import ConsoleShell from "@/components/shell/ConsoleShell";

export default function PageSkeleton({ current }: { current?: string }) {
  return (
    <ConsoleShell
      {...(current !== undefined ? { current } : {})}
      busy
      {...(current === undefined
        ? { title: <span className="skel-bar" style={{ display: "block", width: 220, height: 28 }} />, purpose: null }
        : {})}
    >
      <span className="sr-only">Loading…</span>
      <div className="card">
        <div className="skel-bar" style={{ width: "55%", height: 18 }} />
        <div className="skel-bar" style={{ width: "92%", height: 13, marginTop: 16 }} />
        <div className="skel-bar" style={{ width: "80%", height: 13, marginTop: 8 }} />
        <div className="skel-bar" style={{ width: "68%", height: 13, marginTop: 8 }} />
      </div>
    </ConsoleShell>
  );
}

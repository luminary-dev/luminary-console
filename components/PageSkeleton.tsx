// Instant route-level fallback (AUDIT.md UI-09). The console pages render
// fully server-side and are force-dynamic, so without a loading boundary the
// App Router holds the previous route on screen with no feedback while the
// next server render — which for the hub/clients reads every record — runs.
// A lightweight skeleton gives immediate feedback; the shimmer is neutralised
// under prefers-reduced-motion by the global rule in globals.css.
export default function PageSkeleton() {
  return (
    <main className="wrap" style={{ paddingTop: 40 }} aria-busy="true">
      <span className="sr-only">Loading…</span>
      <div className="skel-bar" style={{ width: 180, height: 28, marginBottom: 22 }} />
      <div className="card">
        <div className="skel-bar" style={{ width: "55%", height: 18 }} />
        <div className="skel-bar" style={{ width: "92%", height: 13, marginTop: 14 }} />
        <div className="skel-bar" style={{ width: "80%", height: 13, marginTop: 8 }} />
        <div className="skel-bar" style={{ width: "68%", height: 13, marginTop: 8 }} />
      </div>
    </main>
  );
}

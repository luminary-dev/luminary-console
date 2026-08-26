import Link from "next/link";
import PublishStudio from "@/components/PublishStudio";
import SignOut from "@/components/SignOut";
import ThemeToggle from "@/components/ThemeToggle";
import AppTabBar from "@/components/AppTabBar";

export const metadata = { title: "Publish" };

// The landing-page publish portal: write (or AI-draft) blog articles and
// portfolio projects, generate their artwork in the house 3D-animation style
// (gpt-image-2), and ship each as a reviewable PR against
// luminary-landing-page's dev branch. Git stays the CMS — this is just the
// desk it's written at.
export default function PublishPage() {
  return (
    <main className="wrap wrap--narrow" style={{ paddingBottom: 80 }}>
      <div className="topbar">
        <div className="brand">
          Luminary<span>.</span>
          <small>Publish to the landing page</small>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <ThemeToggle />
          <SignOut />
          <Link className="btn ghost small app-hide" href="/">
            ← Dashboard
          </Link>
        </div>
      </div>
      {/* Skip-link target. The topbar lives inside <main> on every console
          page, so the jump lands here, after the nav, and the next Tab
          continues into the content. tabIndex makes it focusable, which is
          what moves focus rather than only the scroll position. */}
      <div id="main-content" tabIndex={-1} />

      <PublishStudio />
      <AppTabBar />
    </main>
  );
}

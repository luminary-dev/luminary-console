import PublishStudio from "@/components/PublishStudio";
import ConsoleTopbar from "@/components/ConsoleTopbar";
import { MAIN_ID } from "@/components/SkipLink";
import AppTabBar from "@/components/AppTabBar";

export const metadata = { title: "Publish" };

// The landing-page publish portal: write (or AI-draft) blog articles and
// portfolio projects, generate their artwork in the house 3D-animation style
// (gpt-image-2), and ship each as a reviewable PR against
// luminary-landing-page's dev branch. Git stays the CMS — this is just the
// desk it's written at.
export default function PublishPage() {
  return (
    <div className="wrap" style={{ paddingBottom: 80 }}>
      {/* showNewClient is off: this page is a form you may be part-way
          through, and a primary button that navigates away from unsaved input
          does not belong beside it. */}
      <ConsoleTopbar current="/publish" subtitle="Publish" showNewClient={false} />
      <main id={MAIN_ID}>
      <h1 className="sr-only">Publish studio</h1>
      <PublishStudio />
      </main>
      <AppTabBar />
    </div>
  );
}

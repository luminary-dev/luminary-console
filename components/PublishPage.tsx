// The landing-page publish portal: write (or AI-draft) blog articles and
// portfolio projects, generate their artwork in the house 3D-animation style
// (gpt-image-2), and ship each as a reviewable PR against
// luminary-landing-page's dev branch. Git stays the CMS — this is just the
// desk it's written at.
//
// Two screens share this: Blog posts (/publish) and Portfolio projects
// (/publish/project).
import PublishStudio from "@/components/PublishStudio";
import ConsoleShell from "@/components/shell/ConsoleShell";

export default function PublishPage({ kind }: { kind: "article" | "project" }) {
  const project = kind === "project";
  return (
    <ConsoleShell
      current={project ? "/publish/project" : "/publish"}
      how={
        <p>
          Nothing here goes straight onto the website. Pressing the button at the bottom makes the
          artwork and opens a pull request on the website&apos;s code with your {project ? "project" : "post"} in
          it. A teammate looks it over under Code, Pull requests, and it is live once they add it.
        </p>
      }
    >
      <PublishStudio kind={kind} />
    </ConsoleShell>
  );
}

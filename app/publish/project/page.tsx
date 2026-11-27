// Our website, Portfolio projects: add a finished project and send it for
// approval. Its own address, so the menu can list it beside Blog posts as the
// separate thing it is, instead of one entry called "Publish" with a switch.
import PublishPage from "@/components/PublishPage";

export const metadata = { title: "Portfolio projects" };

export default function PortfolioProjectsPage() {
  return <PublishPage kind="project" />;
}

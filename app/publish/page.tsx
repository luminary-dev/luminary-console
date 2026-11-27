// Our website, Blog posts: write a post and send it for approval.
import PublishPage from "@/components/PublishPage";

export const metadata = { title: "Blog posts" };

export default function BlogPostsPage() {
  return <PublishPage kind="article" />;
}

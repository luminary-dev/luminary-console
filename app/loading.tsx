// The fallback for any screen without one of its own. It names no section,
// because it cannot know which one it is standing in for.
import PageSkeleton from "@/components/PageSkeleton";

export default function Loading() {
  return <PageSkeleton />;
}

import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/learn")({
  component: LearnLayout,
});

/**
 * Layout wrapper for the /learn subtree.
 * The index content lives in learn.index.tsx; lesson pages in learn.$lessonId.tsx.
 */
function LearnLayout() {
  return <Outlet />;
}

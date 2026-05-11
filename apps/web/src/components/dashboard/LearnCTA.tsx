import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { useGetV1LearnState } from "@paper/api-client";
import { LESSONS, TRACKS } from "@paper/shared";
import { Link } from "@tanstack/react-router";

/**
 * Dashboard Learn CTA — shows a summary of the user's learning progress
 * and a button to jump into the first incomplete lesson.
 *
 * Placed between the hero card and TopMoversStrip on the dashboard.
 */
export function LearnCTA() {
  const { data, isLoading } = useGetV1LearnState({ query: { staleTime: 60_000 } });

  const totalLessons = LESSONS.length; // 20
  const completedLessons = data?.lessons.filter((l) => l.completed_at !== null).length ?? 0;
  const allDone = completedLessons === totalLessons;

  // Find the first incomplete lesson across all tracks (sorted by track order, then lesson order).
  const nextLesson = (() => {
    if (!data) return null;
    for (const track of TRACKS) {
      for (const lessonId of track.lessonIds) {
        const state = data.lessons.find((l) => l.id === lessonId);
        if (!state || state.completed_at === null) return lessonId;
      }
    }
    return null;
  })();

  const progressPct = totalLessons > 0 ? (completedLessons / totalLessons) * 100 : 0;

  return (
    <Card tone="lilac" padding="cozy" elevation="flat" className="text-ink">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <Eyebrow className="text-ink/60">Learn</Eyebrow>
          <p className="mt-0.5 font-display font-semibold text-ink text-sm">
            {isLoading
              ? "Loading…"
              : allDone
                ? "All lessons complete ✓"
                : completedLessons === 0
                  ? "Start your first lesson"
                  : `${completedLessons} / ${totalLessons} lessons`}
          </p>
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-ink/15">
            <div
              className="h-full rounded-full bg-ink/50 transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        <Button asChild size="sm" variant="secondary" className="shrink-0">
          <Link
            to={nextLesson ? "/learn/$lessonId" : "/learn"}
            params={nextLesson ? { lessonId: encodeURIComponent(nextLesson) } : undefined}
          >
            {allDone ? "Review" : completedLessons === 0 ? "Start →" : "Continue →"}
          </Link>
        </Button>
      </div>
    </Card>
  );
}

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { useGetV1LearnState } from "@paper/api-client";
import { TRACKS } from "@paper/shared";
import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/learn/")({
  component: LearnPage,
});

function LearnPage() {
  const { data } = useGetV1LearnState({ query: { staleTime: 30_000 } });
  const completedSet = new Set(
    (data?.lessons ?? []).filter((l) => l.completed_at !== null).map((l) => l.id),
  );

  return (
    <main className="min-h-dvh bg-paper px-6 py-8">
      <div className="mx-auto max-w-md space-y-6">
        <div className="flex items-center justify-between">
          <Button asChild variant="ghost" size="sm">
            <Link to="/dashboard">← Back</Link>
          </Button>
        </div>
        <div>
          <Eyebrow>learn</Eyebrow>
          <Heading level="h1" className="mt-1">
            Learn
          </Heading>
          <p className="mt-1 text-ink-soft text-sm">20 lessons across 3 tracks.</p>
        </div>

        <div className="space-y-4">
          {TRACKS.map((track) => {
            const total = track.lessonIds.length;
            const completed = track.lessonIds.filter((id) => completedSet.has(id)).length;
            const allDone = completed === total;
            const someDone = completed > 0 && !allDone;
            const nextIncomplete = track.lessonIds.find((id) => !completedSet.has(id));
            const firstLesson = track.lessonIds[0];
            if (!firstLesson) return null;
            const target = nextIncomplete ?? firstLesson;
            const pct = total > 0 ? (completed / total) * 100 : 0;

            return (
              <Card
                key={track.id}
                tone={track.pastel}
                padding="cozy"
                elevation="pop"
                className="text-ink"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-display font-bold text-base">{track.title}</p>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-ink/15">
                      <div
                        className="h-full rounded-full bg-ink/55 transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="mt-2 text-ink/60 text-sm">
                      {allDone ? "Track complete ✓" : `${completed} / ${total} done`}
                    </p>
                  </div>
                  <Button asChild size="sm" variant="secondary" className="shrink-0">
                    <Link to="/learn/$lessonId" params={{ lessonId: encodeURIComponent(target) }}>
                      {allDone ? "Review" : someDone ? "Continue →" : "Start →"}
                    </Link>
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </main>
  );
}

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { useGetV1Leaderboard } from "@paper/api-client";
import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/leaderboard")({
  component: LeaderboardPage,
});

const PODIUM_TONES = ["peach", "mint", "sky"] as const;

function LeaderboardPage() {
  const { data, isLoading } = useGetV1Leaderboard(undefined, { query: { staleTime: 60_000 } });

  const entries = data?.entries ?? [];
  const myEntry = data?.my_entry ?? null;
  const weekDate = data?.week_starting_date ?? "";

  const myEntryInList = myEntry ? entries.some((e) => e.user_id === myEntry.user_id) : false;

  return (
    <main className="min-h-dvh bg-paper px-6 py-8">
      <div className="mx-auto max-w-md space-y-6">
        <div className="flex items-center justify-between">
          <Button asChild variant="ghost" size="sm">
            <Link to="/dashboard">← Dashboard</Link>
          </Button>
        </div>

        <div>
          <Eyebrow>week of {weekDate}</Eyebrow>
          <Heading level="h1" className="mt-1">
            Leaderboard
          </Heading>
          <p className="mt-1 text-ink-soft text-sm">
            Top traders ranked by portfolio + learning + streaks.
          </p>
        </div>

        {isLoading && (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholder
                key={i}
                className="h-14 animate-pulse rounded-lg bg-surface-2"
              />
            ))}
          </div>
        )}

        {!isLoading && (
          <div className="space-y-2">
            {entries.length === 0 && (
              <p className="py-8 text-center text-ink-soft text-sm">
                No scores yet — check back soon.
              </p>
            )}

            {entries.map((entry) => {
              const isMe = myEntry?.user_id === entry.user_id;
              const tone = entry.rank <= 3 ? PODIUM_TONES[entry.rank - 1] : "paper";

              return (
                <Card
                  key={entry.user_id}
                  tone={tone}
                  elevation={entry.rank <= 3 ? "pop" : "flat"}
                  padding="tight"
                  className={isMe ? "ring-2 ring-ink/30" : ""}
                >
                  <div className="flex items-center gap-3">
                    <span className="w-8 shrink-0 text-center font-display font-bold text-base tabular-nums text-ink/60">
                      {entry.rank <= 3 ? ["🥇", "🥈", "🥉"][entry.rank - 1] : `#${entry.rank}`}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium text-sm text-ink">
                      {entry.handle ?? "anonymous"}
                      {isMe && <span className="ml-1.5 text-ink/50 text-xs">(you)</span>}
                    </span>
                    <span className="shrink-0 font-display font-bold text-base tabular-nums text-ink">
                      {entry.composite_score}
                    </span>
                  </div>
                </Card>
              );
            })}

            {myEntry && !myEntryInList && (
              <>
                <div className="flex items-center gap-2 py-1">
                  <div className="h-px flex-1 bg-ink/10" />
                  <span className="text-ink-soft text-xs">your rank</span>
                  <div className="h-px flex-1 bg-ink/10" />
                </div>
                <Card tone="paper" elevation="flat" padding="tight" className="ring-2 ring-ink/30">
                  <div className="flex items-center gap-3">
                    <span className="w-8 shrink-0 text-center font-display font-bold text-base tabular-nums text-ink/60">
                      #{myEntry.rank}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium text-sm text-ink">
                      {myEntry.handle ?? "anonymous"}
                      <span className="ml-1.5 text-ink/50 text-xs">(you)</span>
                    </span>
                    <span className="shrink-0 font-display font-bold text-base tabular-nums text-ink">
                      {myEntry.composite_score}
                    </span>
                  </div>
                </Card>
              </>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

import { Eyebrow } from "@/components/ui/eyebrow";
import { cn } from "@/lib/cn";
import { useGetV1Assets } from "@paper/api-client";
import { AssetChip } from "./AssetChip";

export function TopMoversStrip() {
  const { data } = useGetV1Assets({ query: { staleTime: 30_000 } });
  const assets = data?.assets ?? [];

  // 5 biggest absolute movers (positive OR negative). Skip rows with no
  // change_24h_pct yet (cold start before first cron tick).
  const movers = assets
    .filter((a) => a.change_24h_pct != null)
    .slice()
    .sort((a, b) => Math.abs(b.change_24h_pct ?? 0) - Math.abs(a.change_24h_pct ?? 0))
    .slice(0, 5);

  if (movers.length === 0) return null;

  return (
    <section aria-label="Top movers today">
      <Eyebrow className="mb-3">top movers today</Eyebrow>
      <ul className="-mx-6 scrollbar-none flex gap-3 overflow-x-auto px-6 pb-2">
        {movers.map((a) => {
          const change = a.change_24h_pct ?? 0;
          const positive = change >= 0;
          return (
            <li
              key={a.id}
              className="flex min-w-[96px] shrink-0 flex-col items-center justify-center gap-2 rounded-2xl bg-surface px-4 py-3 shadow-pop"
            >
              <AssetChip letter={a.id} pastel={a.pastel} size="sm" />
              <div className="font-display font-semibold text-ink text-sm">{a.id}</div>
              <div
                className={cn(
                  "font-display font-semibold text-xs tabular-nums",
                  positive ? "text-up" : "text-down",
                )}
              >
                {positive ? "+" : ""}
                {change.toFixed(2)}%
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

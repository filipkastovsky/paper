import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { cn } from "@/lib/cn";
import { formatUsd } from "@/lib/format";
import { useGetV1Assets } from "@paper/api-client";
import { AssetChip } from "./AssetChip";

export function AssetList() {
  const { data, isLoading } = useGetV1Assets({ query: { staleTime: 30_000 } });
  const assets = data?.assets ?? [];

  return (
    <Card tone="paper" elevation="pop" padding="cozy" className="w-full">
      <Eyebrow className="mb-4">all assets</Eyebrow>
      {isLoading && <div className="py-4 text-ink-soft text-sm">Loading prices…</div>}
      {!isLoading && assets.length === 0 && (
        <div className="py-4 text-ink-soft text-sm">No assets to show.</div>
      )}
      <ul className="divide-y divide-line">
        {assets.map((a) => {
          const change = a.change_24h_pct;
          const changeClass = change == null ? "text-muted" : change >= 0 ? "text-up" : "text-down";
          const sign = change == null ? "" : change >= 0 ? "+" : "";
          return (
            <li key={a.id} className="flex items-center gap-3 py-3">
              <AssetChip letter={a.id} pastel={a.pastel} />
              <div className="flex-1">
                <div className="font-display font-semibold text-ink">{a.name}</div>
                <div className="text-muted text-xs">{a.id}</div>
              </div>
              <div className="text-right">
                <div className="font-display font-semibold text-ink tabular-nums">
                  {a.price_usd != null ? formatUsd(a.price_usd) : "—"}
                </div>
                <div className={cn("text-xs tabular-nums", changeClass)}>
                  {change != null ? `${sign}${change.toFixed(2)}%` : "—"}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

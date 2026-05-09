import { AssetChip } from "@/components/dashboard/AssetChip";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { cn } from "@/lib/cn";
import { formatUsd } from "@/lib/format";
import { useGetV1Trades } from "@paper/api-client";
import { pastelForAsset } from "@paper/shared";

export function TradeHistoryList() {
  const { data, isLoading } = useGetV1Trades({ limit: 20 }, { query: { staleTime: 5_000 } });
  const trades = data?.trades ?? [];

  return (
    <Card tone="paper" elevation="pop" padding="cozy">
      <Eyebrow className="mb-3">recent trades</Eyebrow>
      {isLoading && <div className="py-3 text-ink-soft text-sm">Loading…</div>}
      {!isLoading && trades.length === 0 && (
        <div className="py-3 text-ink-soft text-sm">No trades yet. Place your first one above.</div>
      )}
      <ul className="divide-y divide-line">
        {trades.map((t) => (
          <li key={t.id} className="flex items-center gap-3 py-3">
            <AssetChip
              letter={t.asset_id}
              pastel={pastelForAsset(t.asset_id as Parameters<typeof pastelForAsset>[0])}
              size="sm"
            />
            <div className="flex-1">
              <div className="font-display font-semibold text-ink">
                <span
                  className={cn(
                    "mr-2 rounded-pill px-2 py-0.5 text-xs uppercase tracking-wide",
                    t.side === "buy" ? "bg-mint" : "bg-peach",
                  )}
                >
                  {t.side}
                </span>
                {t.asset_id}
              </div>
              <div className="text-muted text-xs">
                {formatRel(t.created_at)} • @ {formatUsd(Number.parseFloat(t.price_at_execution))}
              </div>
            </div>
            <div className="font-display text-ink font-semibold tabular-nums">
              {formatUsd(Number.parseFloat(t.usd_amount))}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function formatRel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

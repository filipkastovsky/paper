import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { cn } from "@/lib/cn";
import { useTradeStore } from "@/stores/trade-store";
import { useGetV1Assets, useGetV1Me } from "@paper/api-client";
import { useMemo } from "react";
import { AssetPickerRow } from "./AssetPickerRow";

export function TradeForm() {
  const side = useTradeStore((s) => s.side);
  const assetId = useTradeStore((s) => s.assetId);
  const usdInput = useTradeStore((s) => s.usdInput);
  const setSide = useTradeStore((s) => s.setSide);
  const setAssetId = useTradeStore((s) => s.setAssetId);
  const setUsdInput = useTradeStore((s) => s.setUsdInput);
  const openConfirm = useTradeStore((s) => s.openConfirm);

  const me = useGetV1Me({ query: { staleTime: 5_000 } });
  const assets = useGetV1Assets({ query: { staleTime: 30_000 } });

  const cashUsd = me.data ? Number.parseFloat(me.data.portfolio.cash_usd) : 0;
  const heldQty = useMemo(() => {
    const h = me.data?.portfolio.holdings.find((x) => x.asset_id === assetId);
    return h ? Number.parseFloat(h.qty) : 0;
  }, [me.data, assetId]);
  const price = assets.data?.assets.find((x) => x.id === assetId)?.price_usd ?? null;

  const usdNum = Number.parseFloat(usdInput);
  const canReview =
    Number.isFinite(usdNum) &&
    usdNum > 0 &&
    (side === "buy" ? usdNum <= cashUsd : price != null && usdNum / price <= heldQty);

  return (
    <Card tone="paper" elevation="float" padding="lush" className="space-y-5">
      <Eyebrow>place a trade</Eyebrow>
      <Heading level="h2">
        {side === "buy" ? "Buy" : "Sell"} {assetId}
      </Heading>

      {/* Buy / Sell pill toggle */}
      <div
        role="tablist"
        aria-label="Trade side"
        className="grid grid-cols-2 rounded-pill bg-surface-2 p-1 ring-1 ring-line"
      >
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={side === s}
            onClick={() => setSide(s)}
            className={cn(
              "rounded-pill py-2 font-display font-bold text-sm capitalize transition-colors",
              side === s ? "bg-ink text-paper" : "text-ink-soft",
            )}
          >
            {s}
          </button>
        ))}
      </div>

      <div>
        <Eyebrow className="mb-2 block">asset</Eyebrow>
        <AssetPickerRow selected={assetId} onSelect={setAssetId} />
      </div>

      <div>
        <Eyebrow className="mb-2 block">amount (usd)</Eyebrow>
        <div className="flex items-center gap-2 rounded-md bg-surface-2 px-4 py-3 ring-1 ring-line focus-within:ring-ink">
          <span className="font-display text-ink-soft">$</span>
          <input
            inputMode="decimal"
            placeholder="0.00"
            value={usdInput}
            onChange={(e) => setUsdInput(e.target.value.replace(/[^0-9.]/g, ""))}
            className="flex-1 bg-transparent font-display text-2xl outline-none placeholder:text-muted tabular-nums"
            aria-label="USD amount"
          />
        </div>
        <p className="mt-2 text-ink-soft text-xs">
          {side === "buy"
            ? `Cash available: $${cashUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : `You hold ${heldQty.toFixed(8)} ${assetId}${price != null ? ` (~$${(heldQty * price).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})` : ""}`}
        </p>
      </div>

      <Button
        trailing="→"
        fullWidth
        disabled={!canReview}
        aria-disabled={!canReview}
        onClick={openConfirm}
      >
        Review
      </Button>
    </Card>
  );
}

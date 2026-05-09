import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { posthog } from "@/lib/posthog";
import { tradeErrorCopy } from "@/lib/trade-errors";
import { useTradeStore } from "@/stores/trade-store";
import {
  getV1MeQueryKey,
  getV1TradesQueryKey,
  useGetV1Assets,
  usePostV1Trades,
} from "@paper/api-client";
import { pastelForAsset } from "@paper/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

export function ConfirmationSheet() {
  const open = useTradeStore((s) => s.confirmOpen);
  const closeConfirm = useTradeStore((s) => s.closeConfirm);
  const side = useTradeStore((s) => s.side);
  const assetId = useTradeStore((s) => s.assetId);
  const usdInput = useTradeStore((s) => s.usdInput);
  const idempotencyKey = useTradeStore((s) => s.idempotencyKey);
  const openSuccess = useTradeStore((s) => s.openSuccess);

  const assets = useGetV1Assets({ query: { staleTime: 5_000 } });
  const queryClient = useQueryClient();
  const post = usePostV1Trades();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const price = assets.data?.assets.find((a) => a.id === assetId)?.price_usd ?? null;
  const usdNum = Number.parseFloat(usdInput || "0");
  const qty = price && price > 0 ? usdNum / price : 0;
  const pastel = pastelForAsset(assetId);

  async function onConfirm() {
    if (!idempotencyKey) return;
    setErrorMsg(null);
    try {
      const res = await post.mutateAsync({
        data: {
          asset_id: assetId,
          side,
          usd_amount: usdInput,
          idempotency_key: idempotencyKey,
        },
      });
      if (res.is_first_trade) {
        try {
          posthog.capture("first_trade_placed", {
            asset_id: res.trade.asset_id,
            side: res.trade.side,
            usd_amount: res.trade.usd_amount,
          });
        } catch {
          // Telemetry must never block trade flow.
        }
      }
      // Refetch /v1/me + /v1/trades so the dashboard hero + history list update.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getV1MeQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getV1TradesQueryKey() }),
      ]);
      openSuccess({
        id: res.trade.id,
        asset_id: res.trade.asset_id,
        side: res.trade.side,
        usd_amount: res.trade.usd_amount,
        qty: res.trade.qty,
        price_at_execution: res.trade.price_at_execution,
      });
    } catch (err) {
      // Kubb wraps the error with a `cause` containing the parsed body when 4xx/5xx.
      const code =
        (err as { cause?: { error?: string } } | undefined)?.cause?.error ??
        (err as { response?: { data?: { error?: string } } } | undefined)?.response?.data?.error;
      setErrorMsg(tradeErrorCopy(code));
    }
  }

  return (
    <BottomSheet
      open={open}
      onOpenChange={(v) => (v ? null : closeConfirm())}
      title="Review your trade"
    >
      <Card tone={pastel} padding="lush" elevation="flat" className="space-y-3 text-ink">
        <div className="flex items-center justify-between">
          <Eyebrow className="text-ink/60">side</Eyebrow>
          <span className="font-display font-bold uppercase">{side}</span>
        </div>
        <div className="flex items-center justify-between">
          <Eyebrow className="text-ink/60">asset</Eyebrow>
          <span className="font-display font-bold">{assetId}</span>
        </div>
        <div className="flex items-center justify-between">
          <Eyebrow className="text-ink/60">amount</Eyebrow>
          <span className="font-display font-bold tabular-nums">
            $
            {usdNum.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <Eyebrow className="text-ink/60">qty</Eyebrow>
          <span className="font-display font-bold tabular-nums">
            {qty.toFixed(8)} {assetId}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <Eyebrow className="text-ink/60">price now</Eyebrow>
          <span className="font-display font-bold tabular-nums">
            {price != null
              ? `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : "—"}
          </span>
        </div>
      </Card>

      {errorMsg ? (
        <p role="alert" className="mt-3 text-down text-sm">
          {errorMsg}
        </p>
      ) : null}

      <div className="mt-5 grid grid-cols-2 gap-3">
        <Button variant="secondary" onClick={closeConfirm} disabled={post.isPending}>
          Cancel
        </Button>
        <Button onClick={onConfirm} disabled={post.isPending}>
          {post.isPending ? "Confirming…" : "Confirm"}
        </Button>
      </div>
    </BottomSheet>
  );
}

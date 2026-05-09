import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { getStoredUser } from "@/lib/auth";
import { useTradeStore } from "@/stores/trade-store";
import { pastelForAsset } from "@paper/shared";
import { Link } from "@tanstack/react-router";

export function SuccessModal() {
  const open = useTradeStore((s) => s.successOpen);
  const closeSuccess = useTradeStore((s) => s.closeSuccess);
  const resetForNextTrade = useTradeStore((s) => s.resetForNextTrade);
  const last = useTradeStore((s) => s.lastTrade);
  if (!last) return null;

  const handle = getStoredUser()?.handle ?? "you";
  const pastel = pastelForAsset(last.asset_id as Parameters<typeof pastelForAsset>[0]);
  const usd = Number.parseFloat(last.usd_amount);
  const verb = last.side === "buy" ? "bought" : "sold";

  return (
    <BottomSheet open={open} onOpenChange={(v) => (v ? null : closeSuccess())} title="Trade placed">
      <Card tone={pastel} padding="lush" elevation="flat" className="text-ink">
        <Eyebrow className="text-ink/60">share-card preview</Eyebrow>
        <Heading level="h2" className="mt-2">
          @{handle} just {verb} $
          {usd.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} of{" "}
          {last.asset_id} on
        </Heading>
        <p className="mt-1 font-display text-ink/70 text-sm">papercrypto.tech</p>
        <p className="mt-4 text-ink/60 text-xs">
          (Image rendering ships in Plan 7. For now, screenshot this card.)
        </p>
      </Card>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <Button asChild variant="secondary">
          <Link to="/dashboard" onClick={closeSuccess}>
            Dashboard
          </Link>
        </Button>
        <Button onClick={resetForNextTrade}>Place another</Button>
      </div>
    </BottomSheet>
  );
}

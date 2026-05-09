import { ConfirmationSheet } from "@/components/trade/ConfirmationSheet";
import { SuccessModal } from "@/components/trade/SuccessModal";
import { TradeForm } from "@/components/trade/TradeForm";
import { TradeHistoryList } from "@/components/trade/TradeHistoryList";
import { Button } from "@/components/ui/button";
import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/trade")({
  component: TradePage,
});

function TradePage() {
  return (
    <main className="min-h-dvh bg-paper px-6 py-8">
      <div className="mx-auto max-w-md space-y-6">
        <div className="flex items-center justify-between">
          <Button asChild variant="ghost" size="sm">
            <Link to="/dashboard">← Back</Link>
          </Button>
        </div>
        <TradeForm />
        <TradeHistoryList />
      </div>
      <ConfirmationSheet />
      <SuccessModal />
    </main>
  );
}

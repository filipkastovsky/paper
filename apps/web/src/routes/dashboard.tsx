import { AssetList } from "@/components/dashboard/AssetList";
import { HeroPortfolioCard } from "@/components/dashboard/HeroPortfolioCard";
import { TopMoversStrip } from "@/components/dashboard/TopMoversStrip";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  return (
    <main className="min-h-dvh bg-paper px-6 py-8">
      <div className="mx-auto max-w-md space-y-6">
        <HeroPortfolioCard />
        <TopMoversStrip />
        <AssetList />
      </div>
    </main>
  );
}

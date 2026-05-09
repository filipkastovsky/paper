import { AssetList } from "@/components/dashboard/AssetList";
import { HeroPortfolioCard } from "@/components/dashboard/HeroPortfolioCard";
import { TopMoversStrip } from "@/components/dashboard/TopMoversStrip";
import { Button } from "@/components/ui/button";
import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  return (
    <main className="min-h-dvh bg-paper px-6 py-8">
      <div className="mx-auto max-w-md space-y-6">
        <HeroPortfolioCard />
        <Button asChild trailing="→" fullWidth>
          <Link to="/trade">Place a trade</Link>
        </Button>
        <TopMoversStrip />
        <AssetList />
      </div>
    </main>
  );
}

import { AssetList } from "@/components/dashboard/AssetList";
import { DailyQuestionCard } from "@/components/dashboard/DailyQuestionCard";
import { HeroPortfolioCard } from "@/components/dashboard/HeroPortfolioCard";
import { LearnCTA } from "@/components/dashboard/LearnCTA";
import { PushOptIn } from "@/components/dashboard/PushOptIn";
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
        <div className="grid grid-cols-3 gap-3">
          <Button asChild trailing="→" fullWidth>
            <Link to="/trade">Place a trade</Link>
          </Button>
          <Button asChild variant="secondary" trailing="→" fullWidth>
            <Link to="/learn">Learn</Link>
          </Button>
          <Button asChild variant="secondary" trailing="→" fullWidth>
            <Link to="/leaderboard">Leaderboard</Link>
          </Button>
        </div>
        <PushOptIn />
        <LearnCTA />
        <DailyQuestionCard />
        <TopMoversStrip />
        <AssetList />
      </div>
    </main>
  );
}

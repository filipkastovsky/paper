import { StepIndicator } from "@/components/onboarding/StepIndicator";
import { BalanceNumeral } from "@/components/ui/balance-numeral";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { useOnboardingStore } from "@/stores/onboarding-store";
import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/onboarding/balance")({
  component: BalanceReveal,
});

function BalanceReveal() {
  const acknowledge = useOnboardingStore((s) => s.acknowledgeBalance);

  return (
    <div className="space-y-6">
      <StepIndicator current="balance" />
      <Card
        tone="ink"
        elevation="float"
        padding="lush"
        className="relative isolate text-center text-paper"
      >
        <span
          aria-hidden
          className="-top-12 -right-12 pointer-events-none absolute h-44 w-44 rounded-full bg-peach opacity-45 blur-3xl"
        />
        <span
          aria-hidden
          className="-bottom-16 -left-12 pointer-events-none absolute h-52 w-52 rounded-full bg-mint opacity-35 blur-3xl"
        />
        <div className="relative">
          <Eyebrow className="text-paper/55">your starter balance</Eyebrow>
          <BalanceNumeral value={10000} size="xl" noDecimal className="mt-5 block" />
          <Heading level="h2" className="mt-4 text-paper">
            of practice cash, ready to invest.
          </Heading>
          <p className="mt-3 text-paper/70 text-sm sm:text-base">
            Trade the 12 biggest cryptos. No real money — but every win counts.
          </p>
          <Button trailing="→" fullWidth className="mt-8" asChild>
            <Link to="/onboarding/lesson" onClick={() => acknowledge()}>
              Let's go
            </Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}

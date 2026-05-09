import { StepIndicator } from "@/components/onboarding/StepIndicator";
import { BalanceNumeral } from "@/components/ui/balance-numeral";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/onboarding/welcome")({
  component: Welcome,
});

// Note: every onboarding step renders inside the /onboarding layout's
// `max-w-md` container, so the welcome step uses the same single-column
// WelcomeCard on every breakpoint. The marketing-style two-column lockup
// from Plan 1 lived under "/" with `max-w-6xl` and is no longer reachable.
function Welcome() {
  return (
    <div className="space-y-6">
      <StepIndicator current="welcome" />
      <Card
        tone="paper"
        elevation="float"
        padding="lush"
        className="relative isolate w-full text-center"
      >
        <span
          aria-hidden
          className="-top-20 -right-16 pointer-events-none absolute h-56 w-56 rounded-full bg-peach opacity-40 blur-3xl"
        />
        <span
          aria-hidden
          className="-bottom-24 -right-20 pointer-events-none absolute h-64 w-64 rounded-full bg-mint opacity-35 blur-3xl"
        />
        <div className="relative">
          <Eyebrow>welcome to paper</Eyebrow>
          <BalanceNumeral value={10000} size="xl" noDecimal className="mt-5 block" />
          <Heading level="h2" className="mt-4">
            of practice cash. No real money.
          </Heading>
          <p className="mt-4 text-ink-soft text-sm sm:text-base">
            Pastel lessons. A daily question. A streak you'll want to keep.
          </p>
          <Button trailing="→" fullWidth className="mt-8" asChild>
            <Link to="/onboarding/handle">Get started</Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}

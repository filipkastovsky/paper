import { StepIndicator } from "@/components/onboarding/StepIndicator";
import { BalanceNumeral } from "@/components/ui/balance-numeral";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { PhoneFrame } from "@/components/ui/phone-frame";
import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/onboarding/welcome")({
  component: Welcome,
});

function Welcome() {
  return (
    <div className="space-y-6">
      <StepIndicator current="welcome" />
      <div className="grid gap-12 md:grid-cols-2 md:items-center">
        <div className="md:order-1">
          <div className="md:hidden">
            <WelcomeCard />
          </div>
          <div className="hidden md:block">
            <HeroLockup />
          </div>
        </div>
        <div className="hidden md:order-2 md:block">
          <PhoneFrame className="max-w-[340px]">
            <div className="flex h-full w-full flex-col justify-center px-6 py-12">
              <WelcomeCard compact />
            </div>
          </PhoneFrame>
        </div>
      </div>
    </div>
  );
}

function WelcomeCard({ compact = false }: { compact?: boolean }) {
  return (
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
        <BalanceNumeral
          value={10000}
          size={compact ? "lg" : "xl"}
          noDecimal
          className="mt-5 block"
        />
        <Heading level="h2" className="mt-4">
          of practice cash. No real money.
        </Heading>
        <p className="mt-4 text-ink-soft text-sm sm:text-base">
          Pastel lessons. A daily question. A streak you'll want to keep.
        </p>
        <Link to="/onboarding/handle" className="mt-8 block">
          <Button trailing="→" fullWidth>
            Get started
          </Button>
        </Link>
      </div>
    </Card>
  );
}

function HeroLockup() {
  return (
    <div className="text-left">
      <Eyebrow>welcome to paper</Eyebrow>
      <div className="mt-6">
        <BalanceNumeral value={10000} size="xl" noDecimal className="block" />
      </div>
      <Heading level="display" className="mt-6 max-w-[18ch]">
        of practice cash. No real money.
      </Heading>
      <p className="mt-6 max-w-[42ch] text-ink-soft text-base">
        Pastel lessons. A daily question. A streak you'll want to keep.
      </p>
      <div className="mt-10 max-w-sm">
        <Link to="/onboarding/handle">
          <Button trailing="→" fullWidth>
            Get started
          </Button>
        </Link>
      </div>
    </div>
  );
}

import { StepIndicator } from "@/components/onboarding/StepIndicator";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/onboarding/lesson")({
  component: LessonNudge,
});

function LessonNudge() {
  return (
    <div className="space-y-6">
      <StepIndicator current="lesson" />
      <Card tone="paper" elevation="float" padding="lush" className="relative isolate text-center">
        <span
          aria-hidden
          className="-top-16 -right-16 pointer-events-none absolute h-48 w-48 rounded-full bg-lilac opacity-45 blur-3xl"
        />
        <div className="relative">
          <Eyebrow>step 4 of 4</Eyebrow>
          <Heading level="h2" className="mt-3">
            Bite-sized lessons,
            <br />
            two minutes each.
          </Heading>
          <p className="mt-3 text-ink-soft text-sm sm:text-base">
            What is Bitcoin? What's a wallet? What's a stablecoin? We'll teach you the absolute
            basics — pastel cards, no jargon. Coming soon.
          </p>
          <Button trailing="→" fullWidth className="mt-8" asChild>
            <Link to="/dashboard">Skip to my dashboard</Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}

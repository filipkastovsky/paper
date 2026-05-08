import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { getStoredUser } from "@/lib/auth";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: WelcomeScreen,
});

function WelcomeScreen() {
  const user = getStoredUser();
  return (
    <main className="min-h-dvh bg-paper px-6 py-12 flex items-center justify-center">
      <Card
        tone="paper"
        elevation="float"
        padding="lush"
        className="max-w-md w-full text-center relative"
      >
        <span
          aria-hidden
          className="absolute -top-8 -right-8 h-24 w-24 rounded-full bg-peach opacity-50"
        />
        <span
          aria-hidden
          className="absolute -top-2 -right-3 h-12 w-12 rounded-full bg-mint opacity-60"
        />
        <div className="relative">
          <Eyebrow>welcome to paper</Eyebrow>
          <Heading level="display" className="mt-3">
            Learn crypto with $10,000 of practice cash.
          </Heading>
          <p className="mt-4 text-ink-soft">
            No real money. Pastel lessons. A daily question. A streak you'll want to keep.
          </p>
          {user && (
            <p data-testid="user-id" className="mt-3 text-xs text-muted">
              session: {user.id.slice(0, 8)}…
            </p>
          )}
          <Button trailing="→" fullWidth className="mt-8">
            Get started
          </Button>
        </div>
      </Card>
    </main>
  );
}

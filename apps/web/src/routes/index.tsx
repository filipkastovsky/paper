import { BalanceNumeral } from "@/components/ui/balance-numeral";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { PhoneFrame } from "@/components/ui/phone-frame";
import { getStoredUser } from "@/lib/auth";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: WelcomeScreen,
});

function WelcomeScreen() {
  const user = getStoredUser();
  const isDev = import.meta.env.DEV;

  return (
    <main className="min-h-dvh bg-paper px-6 py-12 flex items-center justify-center">
      {/* Mobile-first: single column, the card *is* the screen.
          md+: two-column lockup with type on the left, PhoneFrame preview on the right. */}
      <div className="w-full max-w-6xl grid gap-12 md:grid-cols-2 md:items-center">
        {/* LEFT — type lockup. On mobile this is wrapped in the same Card the
            phone frame previews; on desktop it stands on its own. */}
        <div className="md:order-1">
          {/* Mobile: render inside the Card so the welcome screen still feels
              like a single hero artifact at small sizes. */}
          <div className="md:hidden">
            <WelcomeCard user={user} />
          </div>
          {/* Desktop: the same content, but as a free-standing type lockup. */}
          <div className="hidden md:block">
            <HeroLockup />
          </div>
        </div>

        {/* RIGHT — desktop-only PhoneFrame showing the same card as a preview. */}
        <div className="hidden md:block md:order-2">
          <PhoneFrame className="max-w-[340px]">
            <div className="flex h-full w-full flex-col justify-center px-6 py-12">
              <WelcomeCard user={user} compact />
            </div>
          </PhoneFrame>
        </div>
      </div>

      {/* Dev-only session indicator — hidden in production. The real assertion
          for "auth happened" lives in localStorage; tests check that, not DOM. */}
      {isDev && user && (
        <p
          data-testid="user-id"
          className="fixed bottom-3 right-3 text-[10px] text-muted/70 font-mono pointer-events-none"
        >
          session: {user.id.slice(0, 8)}…
        </p>
      )}
    </main>
  );
}

/**
 * The hero content that sits inside the welcome card on mobile (and inside the
 * phone-frame preview on desktop). Pulls $10,000 out as the hero numeral per
 * Marshmallow §2.2 / §4 — numbers are hero typography.
 */
function WelcomeCard({
  user,
  compact = false,
}: {
  user: ReturnType<typeof getStoredUser>;
  compact?: boolean;
}) {
  return (
    <Card
      tone="paper"
      elevation="float"
      padding="lush"
      className="w-full text-center relative isolate"
    >
      {/* Decorative pastel blobs — peach top-right, mint below-right, separated.
          Sized large + heavily blurred so they read as ambient warmth, not as
          logo placeholders. Opacity in the 0.35–0.45 band per spec §9.2. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -top-20 -right-16 h-56 w-56 rounded-full bg-peach opacity-40 blur-3xl"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute -bottom-24 -right-20 h-64 w-64 rounded-full bg-mint opacity-35 blur-3xl"
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

        <Button trailing="→" fullWidth disabled aria-disabled="true" className="mt-8">
          Coming soon
        </Button>

        {/* Visually-hidden hook so accessibility tools / smoke can confirm an
            authenticated session without leaking engineer-speak into the UI. */}
        {user && (
          <span className="sr-only" data-session-ready="true">
            session ready
          </span>
        )}
      </div>
    </Card>
  );
}

/**
 * Free-standing desktop type lockup — same content as the card, but bigger
 * and left-aligned, with no card chrome. Pairs with a PhoneFrame preview.
 */
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
        <Button trailing="→" fullWidth disabled aria-disabled="true">
          Coming soon
        </Button>
      </div>
    </div>
  );
}

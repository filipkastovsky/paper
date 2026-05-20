import { Button } from "../ui/button";
import { Eyebrow } from "../ui/eyebrow";
import { Heading } from "../ui/heading";
import { PhoneFrame } from "../ui/phone-frame";

/**
 * Reproduction of the Welcome screen (onboarding 1/4) using only Marshmallow
 * primitives + Tailwind utility classes that read tokens.css. No bespoke CSS.
 *
 * This is the reference example — copy the pattern when building the rest of
 * the v0 surface.
 */
export function WelcomeScreen() {
  return (
    <PhoneFrame>
      {/* Pastel field background. CSS custom properties referenced inline so
          you can see the gradient construction; in production, prefer a
          dedicated <PastelField /> component or a Tailwind arbitrary value. */}
      <div
        className="flex flex-1 flex-col px-6 pt-12 pb-8"
        style={{
          background: [
            "radial-gradient(circle at 20% 10%, var(--peach) 0%, transparent 55%)",
            "radial-gradient(circle at 80% 35%, var(--mint) 0%, transparent 55%)",
            "radial-gradient(circle at 30% 85%, var(--lilac) 0%, transparent 60%)",
            "radial-gradient(circle at 90% 95%, var(--sky) 0%, transparent 50%)",
            "var(--paper)",
          ].join(", "),
        }}
      >
        <Eyebrow>· paper ·</Eyebrow>

        <div className="mt-auto mb-6">
          <Eyebrow className="mb-3">The Duolingo of crypto</Eyebrow>
          <Heading level="display" className="mb-4 max-w-[11ch]">
            Learn,{" "}
            <em className="font-medium italic text-peach-deep">play</em>, never
            lose a cent.
          </Heading>
          <p className="max-w-[30ch] font-body text-[15px] leading-relaxed text-ink-soft">
            $10,000 in practice cash. Twenty bite-sized lessons. One paper trade.
          </p>
        </div>

        <Button fullWidth trailing="→">
          Get started
        </Button>

        <p className="mx-auto mt-3 max-w-[28ch] text-center font-display text-[11px] font-medium leading-relaxed text-muted">
          No real money, no KYC. We&apos;ll never ask for your wallet.
        </p>
      </div>
    </PhoneFrame>
  );
}

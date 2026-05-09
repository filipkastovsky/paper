import { BalanceNumeral } from "@/components/ui/balance-numeral";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { parseCash } from "@/lib/currency";
import { useGetV1Me } from "@paper/api-client";

export function HeroPortfolioCard() {
  const { data, isLoading } = useGetV1Me({ query: { staleTime: 15_000 } });
  const total = data ? parseCash(data.portfolio.total_value_usd) : 10000;
  const handle = data?.user.handle ?? null;

  return (
    <Card tone="ink" elevation="float" padding="lush" className="relative isolate text-paper">
      <span
        aria-hidden
        className="-top-14 -right-12 pointer-events-none absolute h-44 w-44 rounded-full bg-peach opacity-45 blur-3xl"
      />
      <span
        aria-hidden
        className="-bottom-16 -left-12 pointer-events-none absolute h-48 w-48 rounded-full bg-mint opacity-35 blur-3xl"
      />
      <div className="relative">
        <Eyebrow className="text-paper/55">{handle ? `@${handle}` : "your portfolio"}</Eyebrow>
        <div className="mt-2">
          <BalanceNumeral value={total} size="lg" softDecimal className="block text-paper" />
        </div>
        <Eyebrow rule className="mt-4 text-paper/60">
          {isLoading ? "loading…" : "0.00% today"}
        </Eyebrow>
      </div>
    </Card>
  );
}

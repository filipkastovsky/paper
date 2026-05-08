import { cn } from "@/lib/cn";
import { splitUsd } from "@/lib/format";

const sizeClass = {
  sm: "text-3xl",
  md: "text-5xl",
  lg: "text-[64px]",
  xl: "text-[78px] sm:text-[96px]",
} as const;

type Props = {
  value: number;
  /** sm = 30px / md = 48px / lg = 64px / xl = onboarding hero (78–96px). */
  size?: keyof typeof sizeClass;
  /** Render the trailing decimal in --ink-soft. Default true. */
  softDecimal?: boolean;
  /** Hide the decimal portion entirely (e.g. onboarding "$10,000"). */
  noDecimal?: boolean;
  className?: string;
};

/**
 * Hero balance type — tabular figures, tight tracking, dollar sign at 50% size.
 * Use `xl` for the onboarding $10K reveal and 9:16 share-card numerals.
 */
export function BalanceNumeral({
  value,
  size = "lg",
  softDecimal = true,
  noDecimal = false,
  className,
}: Props) {
  const { whole, decimal } = splitUsd(value);

  return (
    <span
      className={cn(
        "font-display font-extrabold tabular-nums leading-none tracking-[-0.04em]",
        sizeClass[size],
        className,
      )}
      aria-label={`${whole}.${decimal} dollars`}
    >
      <span aria-hidden className="mr-0.5 align-top text-[0.5em] font-medium text-ink-soft">
        $
      </span>
      <span aria-hidden>
        {whole}
        {!noDecimal && (
          <span className={softDecimal ? "text-ink-soft" : undefined}>.{decimal}</span>
        )}
      </span>
    </span>
  );
}

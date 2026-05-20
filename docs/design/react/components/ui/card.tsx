import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "../../lib/cn";

const card = cva("relative overflow-hidden rounded-lg", {
  variants: {
    tone: {
      paper:   "bg-surface text-ink",
      ink:     "bg-ink text-paper",
      peach:   "bg-peach text-ink",
      mint:    "bg-mint text-ink",
      sky:     "bg-sky text-ink",
      lilac:   "bg-lilac text-ink",
      surface: "bg-surface-2 text-ink",
    },
    elevation: {
      flat:  "",
      pop:   "shadow-pop",
      float: "shadow-float",
    },
    padding: {
      none:  "p-0",
      tight: "p-3",
      cozy:  "p-4",
      cushy: "p-5",
      lush:  "p-6",
    },
  },
  defaultVariants: {
    tone: "paper",
    elevation: "flat",
    padding: "cushy",
  },
});

type CardProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof card>;

/**
 * Tone'd surface. Every card-like element in Marshmallow goes through here.
 * For the Dashboard hero (ink card with pastel blob decorations), pass
 * `tone="ink"` and add absolutely-positioned `bg-peach`/`bg-mint` divs as children.
 */
export function Card({
  tone, elevation, padding, className, ...rest
}: CardProps) {
  return (
    <div className={cn(card({ tone, elevation, padding }), className)} {...rest} />
  );
}

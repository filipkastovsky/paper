import * as React from "react";
import { cn } from "../../lib/cn";

type Props = React.HTMLAttributes<HTMLSpanElement> & {
  /** Render a leading hairline rule (Marshmallow eyebrow style). */
  rule?: boolean;
};

/** ~12.5px uppercase display label with 0.12em tracking. */
export function Eyebrow({ rule, className, children, ...rest }: Props) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2",
        "font-display text-[0.78rem] font-medium uppercase tracking-[0.12em] text-ink-soft",
        className,
      )}
      {...rest}
    >
      {rule && <span aria-hidden className="h-px w-7 bg-current" />}
      {children}
    </span>
  );
}

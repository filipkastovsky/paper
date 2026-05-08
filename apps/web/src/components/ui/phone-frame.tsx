import { cn } from "@/lib/cn";
import type * as React from "react";

type Props = React.HTMLAttributes<HTMLDivElement> & {
  /** Render the iOS notch overlay. Default true. */
  notch?: boolean;
};

/**
 * Marketing/preview phone frame — used in design galleries and screenshots.
 * NOT used in the live product (the product runs full-bleed in a PWA shell).
 */
export function PhoneFrame({ notch = true, className, children, ...rest }: Props) {
  return (
    <div
      className={cn(
        "relative mx-auto w-full max-w-[380px] aspect-[9/19.5]",
        "rounded-[52px] bg-ink p-2.5 shadow-phone",
        className,
      )}
      {...rest}
    >
      {notch && (
        <div
          aria-hidden
          className="absolute left-1/2 top-[18px] z-10 h-[30px] w-[110px] -translate-x-1/2 rounded-full bg-ink"
        />
      )}
      <div className="relative flex h-full w-full flex-col overflow-hidden rounded-[44px] bg-paper">
        {children}
      </div>
    </div>
  );
}

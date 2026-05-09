import { cn } from "@/lib/cn";
import { type VariantProps, cva } from "class-variance-authority";
import * as React from "react";

const button = cva(
  [
    "inline-flex items-center justify-center gap-3",
    "font-display font-bold leading-none select-none",
    "transition-colors duration-150",
    "disabled:opacity-50 disabled:pointer-events-none",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
  ],
  {
    variants: {
      variant: {
        primary: "bg-ink text-paper shadow-inset",
        secondary: "bg-surface-2 text-ink",
        ghost: "bg-transparent text-ink",
        peach: "bg-peach text-ink shadow-inset",
        mint: "bg-mint text-ink shadow-inset",
      },
      size: {
        lg: "rounded-pill px-6 py-4 text-[15px] tracking-[0.02em]",
        md: "rounded-pill px-5 py-3 text-sm tracking-wide",
        sm: "rounded-pill px-4 py-2 text-xs tracking-wide",
      },
      fullWidth: {
        true: "w-full",
        false: "",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "lg",
      fullWidth: false,
    },
  },
);

const trailingToneClass = {
  peach: "bg-peach text-ink",
  mint: "bg-mint text-ink",
  paper: "bg-paper text-ink",
} as const;

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof button> & {
    /** Trailing chip — the "→" inside a peach circle, the Marshmallow CTA tic. */
    trailing?: React.ReactNode;
    /** Tone of the trailing chip. Defaults to `peach`. */
    trailingTone?: keyof typeof trailingToneClass;
    /**
     * When true, render as the single React child (clone with merged className)
     * instead of an HTML <button>. Use when the CTA must be a `<Link>`/`<a>` —
     * nesting `<a><button>` is invalid HTML and makes a11y duplicate-control
     * warnings fire.
     */
    asChild?: boolean;
  };

export function Button({
  variant,
  size,
  fullWidth,
  trailing,
  trailingTone = "peach",
  asChild,
  children,
  className,
  ...rest
}: ButtonProps) {
  const classes = cn(
    button({ variant, size, fullWidth }),
    trailing && "justify-between",
    className,
  );

  const trailingChip = trailing ? (
    <span
      aria-hidden
      className={cn(
        "grid h-8 w-8 place-items-center rounded-full text-sm",
        trailingToneClass[trailingTone],
      )}
    >
      {trailing}
    </span>
  ) : null;

  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<{
      className?: string;
      children?: React.ReactNode;
    }>;
    return React.cloneElement(child, {
      className: cn(classes, child.props.className),
      children: (
        <>
          <span>{child.props.children}</span>
          {trailingChip}
        </>
      ),
    });
  }

  return (
    <button className={classes} {...rest}>
      <span>{children}</span>
      {trailingChip}
    </button>
  );
}

import * as React from "react";
import { cn } from "../../lib/cn";

const levelClass = {
  display: "text-[clamp(3rem,2rem+3.5vw,5.5rem)] tracking-[-0.04em] leading-[0.92] font-bold",
  h1:      "text-[clamp(2rem,1.6rem+1.6vw,3rem)] tracking-[-0.025em] leading-none font-bold",
  h2:      "text-[clamp(1.4rem,1.2rem+0.8vw,1.85rem)] tracking-[-0.02em] leading-tight font-bold",
  h3:      "text-[clamp(1.1rem,1rem+0.4vw,1.3rem)] tracking-tight leading-tight font-semibold",
} as const;

type Props = React.HTMLAttributes<HTMLHeadingElement> & {
  /** Type scale step. Default `h1`. */
  level?: keyof typeof levelClass;
  /** Override the rendered tag. Defaults to the level (display → h1). */
  as?: "h1" | "h2" | "h3" | "h4";
};

/**
 * Marshmallow display heading. Use italic emphasis for the brand-tic — e.g.
 * <Heading level="display">Soft enough to <em className="italic font-medium text-peach-deep">poke.</em></Heading>
 */
export function Heading({
  level = "h1",
  as,
  className,
  children,
  ...rest
}: Props) {
  const Tag = (as ?? (level === "display" ? "h1" : level)) as React.ElementType;
  return (
    <Tag
      className={cn("font-display text-ink", levelClass[level], className)}
      {...rest}
    >
      {children}
    </Tag>
  );
}

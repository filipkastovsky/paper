import { cn } from "@/lib/cn";

const PASTEL_BG: Record<"peach" | "mint" | "sky" | "lilac", string> = {
  peach: "bg-peach",
  mint: "bg-mint",
  sky: "bg-sky",
  lilac: "bg-lilac",
};

export function AssetChip({
  letter,
  pastel,
  size = "md",
  className,
}: {
  letter: string;
  pastel: "peach" | "mint" | "sky" | "lilac";
  size?: "sm" | "md";
  className?: string;
}) {
  const sizeClass = size === "sm" ? "h-7 w-7 text-sm" : "h-9 w-9 text-base";
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex items-center justify-center rounded-full font-display font-extrabold text-ink",
        sizeClass,
        PASTEL_BG[pastel],
        className,
      )}
    >
      {letter.slice(0, 1).toUpperCase()}
    </span>
  );
}

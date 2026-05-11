import { cn } from "@/lib/cn";

export function LessonStepIndicator({
  total,
  current,
}: {
  total: number;
  current: number;
}) {
  return (
    <ol aria-label="Lesson progress" className="flex items-center justify-center gap-1.5">
      {Array.from({ length: total }, (_, i) => {
        const pip = i;
        return (
          <li
            key={pip}
            aria-current={pip === current ? "step" : undefined}
            className={cn(
              "h-2 rounded-full transition-all duration-200",
              pip === current ? "w-5 bg-ink" : pip < current ? "w-2 bg-ink/60" : "w-2 bg-line",
            )}
          />
        );
      })}
    </ol>
  );
}

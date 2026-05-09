import { cn } from "@/lib/cn";
import { STEPS, type Step } from "@/stores/onboarding-store";

export function StepIndicator({ current }: { current: Step }) {
  const idx = STEPS.indexOf(current);
  return (
    <ol aria-label="Onboarding progress" className="flex items-center gap-2">
      {STEPS.map((s, i) => {
        const active = i <= idx;
        return (
          <li
            key={s}
            aria-current={i === idx ? "step" : undefined}
            className={cn(
              "h-1.5 w-8 rounded-full transition-colors",
              active ? "bg-ink" : "bg-line",
            )}
          />
        );
      })}
    </ol>
  );
}

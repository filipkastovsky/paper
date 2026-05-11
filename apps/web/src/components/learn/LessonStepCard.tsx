import { Card } from "@/components/ui/card";
import type { AssetPastel, LessonStep } from "@paper/shared";

export function LessonStepCard({
  step,
  pastel,
}: {
  step: LessonStep;
  pastel: AssetPastel;
}) {
  return (
    <Card tone={pastel} padding="cozy" elevation="pop" className="text-ink">
      <div className="flex flex-col gap-3">
        <p className="text-base leading-relaxed">{step.body}</p>
        {step.bullets && step.bullets.length > 0 ? (
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed">
            {step.bullets.map((b, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: bullet strings are positional-only; no stable id exists
              <li key={i}>{b}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </Card>
  );
}
